'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const identityCard=require('../../src/shared/chinese-identity-card');
test('Chinese identity validation derives birth date and gender from a valid card',()=>{const result=identityCard.validate(' 11010519491231002x ');assert.equal(result.valid,true);assert.equal(result.normalized,'11010519491231002X');assert.equal(result.birthDate,'1949-12-31');assert.equal(result.gender,'女');});
test('Chinese identity validation rejects impossible dates and bad checksums',()=>{assert.equal(identityCard.validate('11010519490231002X').valid,false);assert.equal(identityCard.validate('110105194912310021').valid,false);});
