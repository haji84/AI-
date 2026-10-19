import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseRemoteLite, setupSteps } from '../src/remote-lite/setup-diagnostics.mjs';

const ready = {
  hostInstalled:true,hostOnline:true,ownerAuthenticated:true,deviceRegistered:true,
  devicePermissionGranted:true,signalingReachable:true,directPeerReachable:true,
  relayReachable:false,localScreenConsent:true,deviceBusy:false,nativeSupported:true,
  realFrameReceived:true,inputAcknowledged:true,
};
test('setup cannot claim ready when all evidence is absent or unknown',()=>{
  assert.equal(diagnoseRemoteLite().success,false);
  assert.equal(diagnoseRemoteLite({hostInstalled:true}).code,'HOST_OFFLINE');
  assert.equal(setupSteps.length,6);
});
test('each setup blocker has specific Japanese self-service recovery',()=>{
  const cases = [
    ['hostInstalled','HOST_NOT_INSTALLED'],
    ['hostOnline','HOST_OFFLINE'],['ownerAuthenticated','AUTH_REQUIRED'],
    ['deviceRegistered','REGISTRATION_REQUIRED'],['nativeSupported','NOT_SUPPORTED'],
    ['devicePermissionGranted','PERMISSION_REQUIRED'],
    ['signalingReachable','SIGNALING_OFFLINE'],['localScreenConsent','SCREEN_CONSENT_REQUIRED'],
    ['realFrameReceived','E2E_NOT_VERIFIED'],['inputAcknowledged','E2E_NOT_VERIFIED'],
  ];
  for(const [field,expected] of cases){
    const status=diagnoseRemoteLite({...ready,[field]:false});
    assert.equal(status.code,expected,field);
    assert.equal(status.success,false,field);
    assert.ok(status.title.length>3,field);
  }
});
test('TURN fallback may restore transport but does not override missing frame or input evidence',()=>{
  assert.equal(diagnoseRemoteLite({...ready,directPeerReachable:false,relayReachable:false}).code,'RELAY_UNAVAILABLE');
  assert.equal(diagnoseRemoteLite({...ready,directPeerReachable:false,relayReachable:true}).code,'READY');
  assert.equal(diagnoseRemoteLite({...ready,directPeerReachable:false,relayReachable:true,inputAcknowledged:false}).success,false);
});
test('busy or unsupported device is not considered ready',()=>{
  assert.equal(diagnoseRemoteLite({...ready,deviceBusy:true}).code,'DEVICE_BUSY');
  assert.equal(diagnoseRemoteLite({...ready,nativeSupported:undefined}).code,'NOT_SUPPORTED');
  assert.equal(diagnoseRemoteLite(ready).code,'READY');
});
