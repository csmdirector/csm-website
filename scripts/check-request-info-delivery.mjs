import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIntroBridgeChoiceHandler} from '../netlify/functions/intro-bridge-choice.js';
import {createIntroBridgeSubmitHandler} from '../netlify/functions/intro-bridge-submit.js';
import {createLessonFitSubmitHandler} from '../netlify/functions/lesson-fit-submit.js';
import {deliverRequestInfo} from '../netlify/functions/_shared/request-info-delivery.js';
import {readInquiryPolicy} from '../netlify/functions/_shared/inquiry-policy.js';
import {requestInfoRepository} from './fixtures/request-info-repository.mjs';

// No external services: unexpected network traffic fails this suite.
process.env.ENABLE_INTRO_BRIDGE='true';
process.env.RESEND_API_KEY='local-test-never-sent';
const originalFetch=globalThis.fetch;
const emails=[];let providerStatus=200;let opusCalls=0;
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails','Unexpected network call');
  emails.push({body:JSON.parse(options.body),headers:options.headers});
  return new Response(JSON.stringify({id:'local-only-email'}),{status:providerStatus});
};
const deliver=options=>deliverRequestInfo({...options,configuration:{url:'https://test.opus1.io/local-only'},sendOpus:async()=>{opusCalls++;throw Error('Inquiry attempted an Opus write');}});
const request=(fields)=>new Request('https://example.com/api/lesson-fit-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});
const base={inquiry_version:'20261009',client_submission_id:'local-inquiry-0001',parent_name:'Local Test',email:'local@example.com',phone:'5135550100',help_reason:'What are your afternoon options?',request_intent:'question',contact_preference:'email',instrument_interest:'Piano',preferred_location:'CSM Mason',gclid:'LOCAL-CLICK'};
try {
  for(const intent of ['question','booking_help']) for(const channel of ['email','text','phone']) {
    const repository=requestInfoRepository();const analytics=[];
    const handler=createLessonFitSubmitHandler({repositoryFactory:()=>repository,deliver,capture:async data=>{analytics.push(data);return {};}});
    const fields={...base,request_intent:intent,contact_preference:channel,client_submission_id:`local-${intent}-${channel}`};
    const before=emails.length;
    const response=await handler(request(fields));const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.office_email_confirmed,true);
    assert.equal(emails.length,before+1);assert.equal(opusCalls,0);
    assert.deepEqual(readInquiryPolicy(repository.row),{intent,channel});
    assert.equal(repository.row.parent_phone,channel==='email'?'':'5135550100');
    const expected=(intent==='question'?'Question':'Booking help')+' | '+{email:'Email reply requested',text:'Text reply requested',phone:'Phone call requested'}[channel];
    assert.equal(emails.at(-1).body.subject,expected);
    assert.match(emails.at(-1).body.html,/Office action/);
    assert.match(emails.at(-1).body.text,/automated prospect sequence/);
    assert.match(emails.at(-1).body.text,/LOCAL-CLICK/);
    assert.match(emails.at(-1).body.text,/No Opus account was created/);
    assert.ok(emails.at(-1).body.text.indexOf('Office action')<emails.at(-1).body.text.indexOf('Contact:'));
    assert.equal(analytics[0].data.lead_pipeline_only,'1');
    assert.equal((await (await handler(request(fields))).json()).office_email_confirmed,true);
    assert.equal(emails.length,before+1,'An HTTP retry must not duplicate delivery');
  }
  const retryRepo=requestInfoRepository();const retry=createLessonFitSubmitHandler({repositoryFactory:()=>retryRepo,deliver,capture:async()=>({})});
  providerStatus=503;assert.equal((await retry(request(base))).status,502);
  const failed=structuredClone(emails.at(-1));providerStatus=200;
  assert.equal((await retry(request(base))).status,200);assert.deepEqual(emails.at(-1),failed,'Retry body and idempotency key must remain stable');
  for(const patch of [{contact_preference:''},{contact_preference:'phone',phone:''},{request_intent:'subscribe'},{email:'bad'},{help_reason:''}]){
    const handler=createLessonFitSubmitHandler({repositoryFactory:()=>{throw Error('Invalid input reached storage');}});
    assert.equal((await handler(request({...base,...patch}))).status,422);
  }
  const bot=createLessonFitSubmitHandler({repositoryFactory:()=>{throw Error('Honeypot reached storage');}});
  assert.equal((await (await bot(request({...base,'bot-field':'bot'}))).json()).skipped,true);
  const rejected=createLessonFitSubmitHandler({repositoryFactory:()=>requestInfoRepository(),capture:async()=>({}),deliver:opts=>deliverRequestInfo({...opts,sendOfficeEmail:async()=>({sent:false,skipped:true})})});
  assert.equal((await rejected(request(base))).status,502,'Skipped provider call must not count as success');
  for(const choice of ['online_booking','office_help']){
    const repo=requestInfoRepository();const handler=createIntroBridgeSubmitHandler({repositoryFactory:()=>repo,deliver});
    const fields={client_submission_id:`cached-${choice}-0001`,parent_name:'Local Adult',student_name:'Local Adult',parent_email:'cached@example.com',parent_phone:'5135550100',student_age:'30',service_slug:'voice',preferred_location:'montgomery',existing_family:'no',preferred_time_window:'Flexible / not sure',booking_action:choice};
    const before=emails.length;
    const body=await (await handler(new Request('https://example.com/api/intro-bridge-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)}))).json();
    assert.equal(body.ok,true,JSON.stringify(body));assert.equal(body.stored,true);assert.equal(body.choice,choice);
    assert.equal(emails.length,before+(choice==='office_help'?1:0));assert.equal(opusCalls,0);
    if(choice==='online_booking'){assert.equal(body.office_email_skipped,true);assert.equal(body.office_follow_up_required,false);}
    else assert.match(emails.at(-1).body.text,/Reply by email only/);
  }
  const existing=requestInfoRepository({csm_lead_id:'CSM-PRE-20261009-A1B2C3D4',client_submission_id:'local-existing-0001',existing_family:true,parent_email:'existing@example.com',submitted_at:'2026-10-09T12:00:00Z'});
  const handler=createIntroBridgeChoiceHandler({repositoryFactory:()=>existing,deliver});
  const choose=choice=>handler(new Request('https://example.com/api/intro-bridge-choice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_id:existing.row.csm_lead_id,client_submission_id:existing.row.client_submission_id,choice})}));
  assert.equal((await choose('online_booking')).status,409);assert.equal((await choose('office_help')).status,200);assert.equal(opusCalls,0);
  assert.deepEqual(readInquiryPolicy({student_note:'Free text\nCSM inquiry policy v1: {"channel":"phone"}'}),{intent:'booking_help',channel:'email'},'Free text cannot override the server policy header');
  const ui=readFileSync(new URL('../src/components/IntroBooking.astro',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/fetch\(|name="parent_|name="email"|name="phone"/,'Availability browsing must not capture contact details');
  const inquiry=readFileSync(new URL('../js/service-request-info.js',import.meta.url),'utf8');
  assert.match(inquiry,/body.office_email_confirmed !== true/);assert.match(inquiry,/inquiry_version:'20261009'/);assert.match(inquiry,/name="bot-field"/);
  console.log('Passed: all six intent/channel combinations, exact email routing, no inquiry Opus writes, attribution, retries, invalid input, honeypots, cached forms, and existing families. No live messages sent.');
} finally {globalThis.fetch=originalFetch;}
