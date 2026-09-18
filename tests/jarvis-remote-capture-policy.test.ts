import test from 'node:test';
import assert from 'node:assert/strict';
import {isRecoverableCaptureFailure, remoteCaptureGapMs} from '../src/jarvis/remote-capture-policy.ts';
test('only explicitly classified screenshot failures can retain session',()=>{
 assert.equal(isRecoverableCaptureFailure('screenshot',503,{code:'REMOTE_CAPTURE_UNAVAILABLE'}),true);
 for(const status of [401,403,409])assert.equal(isRecoverableCaptureFailure('screenshot',status,{code:'REMOTE_CAPTURE_UNAVAILABLE'}),false);
 assert.equal(isRecoverableCaptureFailure('tap',503,{code:'REMOTE_CAPTURE_UNAVAILABLE'}),false);
 assert.equal(isRecoverableCaptureFailure('screenshot',503,{}),false);
});
test('KYV uses measured conservative gap, other devices keep prior speed',()=>{
 assert.equal(remoteCaptureGapMs('Android 016 · KYOCERA KYV47'),1500);
 assert.equal(remoteCaptureGapMs('Android 006 · KYOCERA KYV44'),1500);
 assert.equal(remoteCaptureGapMs('Android 009 · UMIDIGI'),100);
});
