'use strict';
importScripts('building-inputs.js','reservation-model.js','reservation-profile.js','spatial-occupancy-model.js','spatial-thermal-model.js','environment-dataset.js','hvac-response-model.js','hvac-predictive-model.js');
self.onmessage=e=>{try{
  const records=environmentDataset.records.filter(r=>r.date===e.data.date),result=hvacPredictiveModel.runDay(records,reservationArtifact,{...e.data.options,onDecision:p=>{if((p.minute-390)%60===0)self.postMessage({type:'progress',minute:p.minute});}});
  self.postMessage({type:'complete',result});
}catch(error){self.postMessage({type:'error',message:error.message});}};
