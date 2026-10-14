'use strict';

// Module 1 v2: geometry referenced to the seat plan, occupancy still hypothetical.
// The existing frozen model forecasts ONLY the next total, not seat locations.
const spatialOccupancyModel = (() => {
  const patterns = Object.freeze({uniform:'均匀分散',window:'优先南侧靠窗（图左）',inner:'优先北侧内侧（图右）',west:'优先西段（图上）',east:'优先东段（图下）'});
  const geometry=Object.freeze({orientation:Object.freeze({up:'west',down:'east',left:'south',right:'north'}),
    windowWalls:Object.freeze(['south']),floorAreaM2:378,floorAreaMeasured:false,zoneAreasMeasured:false,
    capacitySource:'座位图编号及较宽横向通道归并：图左1—160，图右161—314',
    orientationSource:'以用户给出的南窗在图左作为参照；按通常非镜像平面图，上西下东左南右北',
    lightingGroupMappingVerified:false});
  const zones = Object.freeze([
    {id:'south-west',name:'南侧西段 · 靠窗',side:'south',segment:'west',capacity:70,areaM2:null,seatIdRange:[91,160],directWindowBoundary:true},
    {id:'south-east',name:'南侧东段 · 靠窗',side:'south',segment:'east',capacity:90,areaM2:null,seatIdRange:[1,90],directWindowBoundary:true},
    {id:'north-west',name:'北侧西段 · 内侧',side:'north',segment:'west',capacity:70,areaM2:null,seatIdRange:[245,314],directWindowBoundary:false},
    {id:'north-east',name:'北侧东段 · 内侧',side:'north',segment:'east',capacity:84,areaM2:null,seatIdRange:[161,244],directWindowBoundary:false}
  ].map(z=>Object.freeze({...z,seatIdRange:Object.freeze(z.seatIdRange)})));
  const priorityGroups={uniform:[[0,1,2,3]],window:[[0,1],[2,3]],inner:[[2,3],[0,1]],west:[[0,2],[1,3]],east:[[1,3],[0,2]]};
  const orders=Object.fromEntries(Object.keys(patterns).map(pattern=>[pattern,priorityGroups[pattern].flatMap(indices=>{
    const tokens=indices.flatMap(i=>Array.from({length:zones[i].capacity},(_,k)=>({zone:i,rank:(k+.5)/zones[i].capacity})));
    tokens.sort((a,b)=>a.rank-b.rank||a.zone-b.zone);
    return tokens.map(t=>t.zone);
  })]));
  function validatePeople(people) {
    if(!Number.isInteger(people)||people<0||people>314)throw new Error('Expected an integer scenario total from 0 to 314');
  }
  function validatePattern(pattern) {
    if(!Object.hasOwn(patterns,pattern))throw new Error('Unknown spatial allocation scenario');
  }
  function allocate(people,pattern='uniform') {
    validatePeople(people);validatePattern(pattern);
    // Priority and proportional spread are explicit allocation assumptions;
    // they do not identify occupied seat numbers or model actual migration.
    const counts=[0,0,0,0];
    for(const zone of orders[pattern].slice(0,people))counts[zone]++;
    if(counts.reduce((sum,n)=>sum+n,0)!==people||counts.some((n,i)=>n<0||n>zones[i].capacity))throw new Error('Spatial capacity conservation failed');
    return counts;
  }
  function frame(people,pattern) {
    const counts=allocate(people,pattern);
    return {totalPeople:people,pattern,patternLabel:patterns[pattern],counts,
      zones:zones.map((z,i)=>({...z,seatIdRange:[...z.seatIdRange],people:counts[i],occupiedInScenario:counts[i]>0})),
      occupiedZoneCount:counts.filter(n=>n>0).length};
  }
  function slotTime(slot) {
    return `${String(Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'30':'00'}`;
  }
  function buildDemand(record,artifact,input={}) {
    if(!record||!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||!Number.isInteger(record.slot)||record.slot<0||record.slot>47)throw new Error('Invalid current historical record');
    const manual=Object.hasOwn(input,'currentPeople');
    const people=manual?input.currentPeople:record.floorReservationProxy;
    const currentPattern=input.currentPattern??'uniform';
    const requestedFuture=input.futurePattern??'same';
    const futurePattern=requestedFuture==='same'?currentPattern:requestedFuture;
    validatePeople(people);validatePattern(currentPattern);validatePattern(futurePattern);
    const current=frame(people,currentPattern);
    const prediction=record.slot<47?reservationModel.transfer(artifact,record.slot,people):null;
    const future=prediction?{...frame(prediction.people,futurePattern),targetSlot:record.slot+1,time:slotTime(record.slot+1)}:null;
    return {version:2,module:'spatial-demand-only',geometry,date:record.date,slot:record.slot,time:slotTime(record.slot),
      currentSource:manual?'manual_scenario':'registered_proxy',current,future,
      forecastTotal:prediction,forecastAvailable:Boolean(prediction),
      forecastUnavailableReason:prediction?null:'23:30之后没有本日下一采样点；不跨日拼接或显示伪造预测',
      allocationRuleChanged:futurePattern!==currentPattern,
      changes:future?zones.map((z,i)=>({id:z.id,name:z.name,currentPeople:current.counts[i],futurePeople:future.counts[i],
        difference:future.counts[i]-current.counts[i],
        state:current.counts[i]===0&&future.counts[i]>0?'scenario_entry':current.counts[i]>0&&future.counts[i]===0?'scenario_exit':
          current.counts[i]>0&&future.counts[i]>0?'scenario_occupied':'scenario_empty'})):null,
      limitations:[
        '当前历史人数是含暂离的一楼登记代理；人工输入同样为情景，不是实际在座',
        '下一半小时总人数由既有冻结模型提供；区域人数仅按指定规则分配，未训练或验证区域预测',
        '仅南侧有窗；图左为南，上为西。四区按座位编号及横向通道归并，不是四个独立空调区',
        '各区面积未实测，灯位映射未核实；不再从14个照明分组套用四区容量或采光关系',
        '占用标记仅用于情景比较，不证明实际无人，不触发空调或照明控制',
        '本模块不计算室温、供冷覆盖、空调用电或节电；两台与各区的关系留待后续模块'
      ]};
  }
  return {patterns,zones,geometry,allocate,frame,slotTime,buildDemand};
})();

if(typeof module!=='undefined'&&module.exports)module.exports=spatialOccupancyModel;
