
(function(){
  'use strict';

  window.closeModal=function(){const root=document.getElementById('modalRoot');if(root)root.innerHTML='';document.body.classList.remove('modal-open');};
  const modalRoot=document.getElementById('modalRoot');
  if(modalRoot&&typeof MutationObserver!=='undefined'){
    new MutationObserver(function(){
      document.body.classList.toggle('modal-open',!!modalRoot.querySelector('.modal-backdrop'));
    }).observe(modalRoot,{childList:true});
  }

  /* ---------- reliable workflow registration ---------- */
  state.approvalStatus = state.acceptedAssets[3] ? 'Approved' : 'Ready for routing';
  state.approvalSubmitting = false;
  state.approvalCompleted = !!state.acceptedAssets[3];
  state.approvalConditions = state.approvalConditions || 'Proceed subject to validation of the active-user baseline, eligible population, consent basis and supporting evidence for quantified claims.';
  state.approvalRecordId = state.acceptedAssets[3]?.id || null;
  state.workfrontReference = state.workfrontReference || null;
  state.registrationStartedAt = null;
  state.registrationTimer = null;

  function clearBlockingUi(){
    const modalRoot=document.getElementById('modalRoot');
    if(modalRoot && !modalRoot.querySelector('.modal-backdrop')) modalRoot.innerHTML='';
    document.body.classList.remove('modal-open');
  }

  beginAssetRegistration = function(i,label,onRegistered){
    if(state.savingStage!==null){toast('Another asset is currently being registered');return;}
    if(state.generatingStage!==null){toast('Wait for the current generation to finish');return;}
    if(state.acceptedAssets[i]){toast(assetDef(i).name+' is already accepted');return;}
    state.savingStage=i;
    state.savingLabel=assetDef(i).savingLabel;
    state.pendingAcceptance={stage:i,label:label||assetDef(i).name};
    state.registrationStartedAt=Date.now();
    state.focusStage=i;
    renderAll();
    clearTimeout(state.registrationTimer);
    state.registrationTimer=setTimeout(function(){
      try{
        if(state.acceptedAssets[i]) return;
        const id=makeAssetId(i);
        state.acceptedAssets[i]={id,label:label||assetDef(i).name,acceptedAt:'Registered just now'};
        if(i===1){state.briefId=id;state.briefAcceptanceCount+=1;state.segmentGenerated=false;state.segmentPrompt='';}
        state.completed.add(i);
        state.nextStageReady=assetDef(i).nextStageIndex;
        if(typeof onRegistered==='function') onRegistered(id);
        addActivity(assetDef(i).name+' accepted and registered · '+id);
        toast(assetDef(i).name+' registered · '+id);
      }catch(err){
        console.error('Asset registration failed',err);
        toast('The mock registration could not complete. Please try again.');
      }finally{
        state.savingStage=null;
        state.savingLabel='';
        state.pendingAcceptance=null;
        state.registrationStartedAt=null;
        state.registrationTimer=null;
        clearBlockingUi();
        renderAll();
      }
    },2600);
  };

  openBriefApprovalModal = function(){
    if(state.approvalSubmitting){toast('The Workfront approval is already being processed');return;}
    if(state.acceptedAssets[3]){toast('The Brief Approval package is already approved');return;}
    const root=document.getElementById('modalRoot');
    root.innerHTML=`<div class="modal-backdrop" role="dialog" aria-modal="true" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>Route the Brief Approval package</h2><p>Create an Adobe Workfront approval record containing the accepted Campaign Brief, Segment Set, source lineage, evidence gaps and approval conditions.</p><div class="field"><label>Campaign owner</label><select id="wfCampaignOwner"><option>James Okonkwo — Head of GTB</option></select></div><div class="field"><label>Required reviewer</label><select id="wfBrandReviewer"><option>Helen Marsh — Brand Lead</option></select></div><div class="field"><label>Approval decision</label><select id="approvalDecision"><option value="conditional">Approve with conditions</option><option value="approve">Approve</option></select></div><div class="field"><label>Conditions</label><textarea id="approvalConditions">${esc(state.approvalConditions)}</textarea></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="submitWorkfrontApproval" onclick="submitBriefApproval()">Create tasks and send</button></div></div></div>`;
  };

  submitBriefApproval = function(){
    if(state.approvalSubmitting || state.acceptedAssets[3]) return;
    const decision=document.getElementById('approvalDecision')?.value || 'conditional';
    const conditions=(document.getElementById('approvalConditions')?.value || '').trim();
    const submit=document.getElementById('submitWorkfrontApproval');
    if(submit){submit.disabled=true;submit.textContent='Sending…';}
    state.approvalSubmitting=true;
    state.approvalStatus='Routing to Workfront';
    state.approvalConditions=conditions;
    state.savingStage=3;
    state.savingLabel='Creating approval tasks in Adobe Workfront…';
    state.pendingAcceptance={stage:3,label:'Brief approval package'};
    state.registrationStartedAt=Date.now();
    closeModal();
    addActivity('Brief Approval package submitted to Adobe Workfront'+(decision==='conditional'?' with conditions':''));
    renderAll();
    clearTimeout(state.registrationTimer);
    state.registrationTimer=setTimeout(function(){
      try{
        if(!state.acceptedAssets[3]){
          const id=makeAssetId(3);
          const wf='WF-APR-'+String(Date.now()).slice(-6);
          state.acceptedAssets[3]={
            id,
            label:'Brief approval package',
            acceptedAt:'Registered just now',
            decision:decision==='conditional'?'Approved with conditions':'Approved',
            conditions:conditions || 'No additional conditions',
            workfrontReference:wf,
            approvedBy:'James Okonkwo and Helen Marsh'
          };
          state.approval=true;
          state.approvalCompleted=true;
          state.approvalStatus=decision==='conditional'?'Approved with conditions':'Approved';
          state.approvalRecordId=id;
          state.workfrontReference=wf;
          state.completed.add(3);
          state.nextStageReady=4;
          addActivity('Brief Approval completed in Adobe Workfront · '+id);
          toast('Brief Approval completed · '+id);
        }
      }catch(err){
        console.error('Workfront approval failed',err);
        state.approval=false;
        state.approvalCompleted=false;
        state.approvalStatus='Ready for routing';
        toast('The Workfront approval could not complete. Please try again.');
      }finally{
        state.approvalSubmitting=false;
        state.savingStage=null;
        state.savingLabel='';
        state.pendingAcceptance=null;
        state.registrationStartedAt=null;
        state.registrationTimer=null;
        clearBlockingUi();
        renderAll();
      }
    },2900);
  };

  renderApproval = function(){
    const selected=commentsForStage(3).filter(c=>c.selected&&!c.incorporated).length;
    const segs=state.segments.filter(s=>s.selected).map(s=>s.name).join(', ');
    const rec=state.acceptedAssets[3];
    const status=rec ? (rec.decision||'Approved') : state.approvalSubmitting ? 'Routing to Workfront' : 'Awaiting approval';
    const processing=state.approvalSubmitting || state.savingStage===3;
    return `${stageHeader(3,'Brief approval','The Marketing Strategy & Campaign Brief Agent packages the accepted brief and segment decisions for human governance in Adobe Workfront.')}
      <p class="answer-intro">The approval package keeps the campaign opportunity, selected cohorts, source lineage and unresolved evidence gaps visible so the human approvers can make a conditioned decision.</p>
      <div class="artifact" id="brief-approval-package"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(3)}Campaign Brief approval package</div>${renderAssetHeaderRight(3,status)}</div>
      <div class="artifact-body"><div class="approval-summary-grid"><div class="approval-summary-item"><label>Campaign objective</label><span>Increase awareness, first meaningful use and deeper iPortal adoption.</span></div><div class="approval-summary-item"><label>Accepted brief</label><span>${esc(state.briefId||'Campaign brief accepted')}</span></div><div class="approval-summary-item"><label>Selected cohorts</label><span>${esc(segs||'No cohorts selected')}</span></div><div class="approval-summary-item"><label>Channels</label><span>${esc(state.channels.join(' · '))}</span></div><div class="approval-summary-item"><label>Budget and timing</label><span>£310,102 · September launch · phased activation</span></div><div class="approval-summary-item"><label>Source lineage</label><span>Teams discussion · Outlook roadmap review · SharePoint campaign documents</span></div></div>
      <div class="callout warning">${ICON.warn}<div><strong>Approval conditions</strong><br>${esc(state.approvalConditions)}</div></div>
      <div class="table"><div class="tr head"><div>Approver</div><div>Responsibility</div><div>Decision</div><div>Status</div></div><div class="tr"><div><strong>James Okonkwo</strong></div><div>Campaign owner</div><div>Strategy, scope and investment</div><div class="row-status ${rec?'pass':'flag'}">${rec?'Approved':'Pending'}</div></div><div class="tr"><div><strong>Helen Marsh</strong></div><div>Brand lead</div><div>Evidence gaps and mandatory constraints</div><div class="row-status ${rec?'pass':'flag'}">${rec?'Approved with conditions':'Pending'}</div></div></div>
      ${rec?`<div class="approval-record"><div><label>Approval ID</label><span>${esc(rec.id)}</span></div><div><label>Workfront record</label><span>${esc(rec.workfrontReference||state.workfrontReference||'Recorded')}</span></div><div><label>Approved by</label><span>${esc(rec.approvedBy||'James Okonkwo and Helen Marsh')}</span></div><div><label>Decision</label><span>${esc(rec.decision||'Approved')}</span></div></div>`:''}
      </div><div class="artifact-actions"><button class="btn" ${processing?'disabled':''} onclick="openAssetEditModal(3)">Edit</button><button class="btn" ${processing?'disabled':''} onclick="regenerateStageFromChat(3)">Regenerate</button><button class="btn" ${processing||!selected?'disabled':''} onclick="applyStageComments(3)">Generate with collaborator comments (${selected})</button><button class="btn primary" ${processing||rec?'disabled':''} onclick="openBriefApprovalModal()">${rec?'Approved':'Route in Workfront'}</button>${processing?`<div class="approval-processing-state"><div class="approval-processing-spinner"></div><div class="approval-processing-copy"><strong>${esc(state.savingLabel||'Processing the Workfront approval…')}</strong><span>Attaching the Brief and Segment Set, recording approver decisions and registering the governance record.</span></div></div>`:''}${renderInlineOperation(3)}</div></div>`;
  };

  /* Recover stale mock locks instead of leaving a dead end. */
  setInterval(function(){
    if(state.registrationStartedAt && Date.now()-state.registrationStartedAt>12000){
      console.warn('Recovered a stale mock registration state');
      state.approvalSubmitting=false;
      state.savingStage=null;
      state.savingLabel='';
      state.pendingAcceptance=null;
      state.registrationStartedAt=null;
      clearBlockingUi();
      renderAll();
      toast('The previous mock operation was reset. You can try again.');
    }
  },2500);

  /* ---------- stable Teams rendering and playback ---------- */
  teamsState.paused=false;
  teamsState.timelineIndex=0;
  teamsState.stableSequenceRunning=false;
  teamsState.systemEvents=[];
  teamsState._lastRenderedMessageCount=0;
  teamsState._lastSummaryReady=false;

  function hashText(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return String(h>>>0);}
  function stableDelay(ms,runId){
    return new Promise(resolve=>{
      let remaining=ms,last=Date.now();
      const tick=()=>{
        if(runId!==teamsState.runId){resolve(false);return;}
        const now=Date.now();
        if(!teamsState.paused) remaining-=now-last;
        last=now;
        if(remaining<=0){resolve(true);return;}
        setTimeout(tick,Math.min(100,remaining));
      };
      setTimeout(tick,50);
    });
  }

  function ensurePlaybackControls(){
    const actions=document.querySelector('.teams-top-actions');
    if(!actions||document.getElementById('teamsPlaybackControls'))return;
    const replay=[...actions.querySelectorAll('button')].find(b=>/Replay discussion/i.test(b.textContent));
    const wrap=document.createElement('span');
    wrap.className='teams-playback-controls';wrap.id='teamsPlaybackControls';
    wrap.innerHTML='<button class="teams-top-button" id="teamsPauseButton" onclick="pauseTeamsDiscussion()">Pause</button><button class="teams-top-button" id="teamsResumeButton" onclick="resumeTeamsDiscussion()" disabled>Resume</button>';
    if(replay) actions.insertBefore(wrap,replay); else actions.appendChild(wrap);
  }

  function stableParticipantStatus(p){
    const active=teamsParticipantActivity();
    if(active&&active.initials===p.initials)return active.status;
    if(p.initials==='AI')return teamsState.provenanceReady?'Provenance retained':teamsState.contextShared?'Context shared':'Following the discussion';
    if(p.initials==='CA')return teamsState.summaryReady?'Brief prepared':teamsState.generating?teamsState.thinkingStatuses[teamsState.thinkingStep]:teamsState.agentRecommendationReady&&!teamsState.authorised?'Waiting for confirmation':teamsState.creationAgentIntroReady?'Listening to the team':teamsState.creationAgentAdded?'Context received':'Waiting to be invited';
    return p.defaultStatus;
  }

  renderTeamsPeople = function(){
    const panel=document.getElementById('teamsPeople');if(!panel)return;
    const backdrop=document.getElementById('teamsPeopleBackdrop');
    panel.classList.toggle('open',!!teamsState.peopleOpen);if(backdrop)backdrop.classList.toggle('open',!!teamsState.peopleOpen);
    const active=teamsParticipantActivity();
    const expected=TEAMS_PARTICIPANTS.length;
    if(panel.querySelectorAll('.teams-person[data-initials]').length!==expected){
      panel.innerHTML=`<div class="teams-people-head"><div><h3>People in this discussion</h3><div class="teams-people-count">${expected} participants</div></div><button class="teams-people-close" onclick="toggleTeamsPeople(false)">×</button></div>`+TEAMS_PARTICIPANTS.map(p=>`<div class="teams-person ${p.type==='agent'?'agent-row':''}" data-initials="${esc(p.initials)}"><div class="teams-person-avatar-wrap"><div class="teams-avatar ${p.type==='agent'?'agent':''}">${esc(p.initials)}</div><span class="teams-person-presence-dot ${p.presence==='away'?'away':''}"></span></div><div class="teams-person-copy"><strong>${esc(p.name)}</strong><span class="teams-person-role">${esc(p.role)}</span><span class="teams-person-status"></span></div></div>`).join('');
    }
    TEAMS_PARTICIPANTS.forEach(p=>{
      const row=panel.querySelector(`.teams-person[data-initials="${p.initials}"]`);if(!row)return;
      row.classList.toggle('active',!!active&&active.initials===p.initials);
      const status=row.querySelector('.teams-person-status');if(status)status.textContent=stableParticipantStatus(p);
    });
  };

  renderTeams = function(){
    ensurePlaybackControls();
    const feed=document.getElementById('teamsFeedInner');if(!feed)return;
    const defs=[];
    (teamsState.systemEvents||[]).forEach((e,i)=>defs.push({key:'event-'+i+'-'+hashText(e.text),html:`<div class="teams-system-event ${e.context?'context-share':''}"><span class="teams-system-event-icon">${e.context?'↗':'＋'}</span><span>${esc(e.text)}</span><time>${esc(e.time||'Now')}</time></div>`}));
    teamsState.messages.forEach((m,i)=>defs.push({key:'message-'+(m.id||('system-'+i+'-'+hashText(m.text||''))),html:renderTeamsPost(m)}));
    if(teamsState.typing&&teamsState.typing.kind==='message')defs.push({key:'typing-main',html:teamsTypingCard()});
    if(teamsState.generating)defs.push({key:'agent-generation',html:`<div class="teams-post agent-post agent-message"><div class="teams-post-top"><div class="teams-avatar agent">CA</div><div class="teams-author"><strong>Marketing Strategy & Campaign Brief Agent</strong><span>AI Campaign Specialist · preparing campaign</span></div></div><div class="teams-thinking" style="margin:12px 0 0 41px"><div class="teams-thinking-copy">${esc(teamsState.thinkingStatuses[teamsState.thinkingStep])} <span class="thinking-dots"><span></span><span></span><span></span></span></div></div></div>`});
    else if(teamsState.summaryReady)defs.push({key:'agent-summary',html:`<div class="teams-post agent-post agent-message"><div class="teams-post-top"><div class="teams-avatar agent">CA</div><div class="teams-author"><strong>Marketing Strategy & Campaign Brief Agent</strong><span>AI Campaign Specialist · campaign prepared</span></div></div>${renderTeamsSummary()}</div>`});

    const existing=new Map([...feed.children].map(el=>[el.dataset.stableKey,el]));
    defs.forEach(def=>{
      const sig=hashText(def.html);let node=existing.get(def.key);
      if(!node){node=document.createElement('div');node.className='teams-stable-item';node.dataset.stableKey=def.key;node.dataset.signature=sig;node.innerHTML=def.html;}
      else if(node.dataset.signature!==sig){node.dataset.signature=sig;node.innerHTML=def.html;}
      feed.appendChild(node);existing.delete(def.key);
    });
    existing.forEach(node=>node.remove());

    const chip=document.getElementById('teamsAgentChip');
    if(chip)chip.textContent=teamsState.paused?'Discussion paused':teamsState.generating?'Marketing Strategy & Campaign Brief Agent preparing brief':teamsState.summaryReady?'Campaign brief prepared':teamsState.agentRecommendationReady&&!teamsState.authorised?'Marketing Strategy & Campaign Brief Agent awaiting approval':'Campaign support active';
    const pause=document.getElementById('teamsPauseButton'),resume=document.getElementById('teamsResumeButton');
    if(pause)pause.disabled=teamsState.paused||teamsState.summaryReady;if(resume)resume.disabled=!teamsState.paused||teamsState.summaryReady;
    renderTeamsPeople();

    const count=teamsState.messages.length+(teamsState.systemEvents||[]).length;
    const meaningfulNew=count>teamsState._lastRenderedMessageCount||(!teamsState._lastSummaryReady&&teamsState.summaryReady);
    teamsState._lastRenderedMessageCount=count;teamsState._lastSummaryReady=teamsState.summaryReady;
    if(meaningfulNew)requestAnimationFrame(()=>{const c=document.getElementById('teamsFeed');if(c)c.scrollTo({top:c.scrollHeight,behavior:'smooth'});});
  };

  async function stableShowDiscussionItem(item,runId,first){
    if(!first && !await stableDelay(1450,runId))return false;
    if(item.type==='reaction'){
      const m=teamsState.messages.find(x=>x.id===item.parentId);if(m){m.reactions=item.count;teamsState.reactionPulse=m.id;renderTeams();await stableDelay(650,runId);teamsState.reactionPulse=null;renderTeams();}return runId===teamsState.runId;
    }
    if(item.type==='message')teamsState.typing={kind:'message',initials:item.message.initials,name:item.message.name,role:item.message.role};
    if(item.type==='reply')teamsState.typing={kind:'reply',parentId:item.parentId,initials:item.reply.initials,name:item.reply.name,role:item.reply.role};
    renderTeams();if(!await stableDelay(1900,runId))return false;
    teamsState.typing=null;
    if(item.type==='message'&&!teamsState.messages.some(m=>m.id===item.message.id)){teamsState.messages.push(cloneTeamsValue(item.message));teamsState.activeParticipant=item.message.initials;teamsState.activeParticipantStatus='Contributing to the discussion…';}
    if(item.type==='reply'){const m=teamsState.messages.find(x=>x.id===item.parentId);if(m&&!m.replies.some(r=>r.time===item.reply.time&&r.initials===item.reply.initials)){m.replies.push(cloneTeamsValue(item.reply));teamsState.activeParticipant=item.reply.initials;teamsState.activeParticipantStatus='Replying in thread…';}}
    renderTeams();return true;
  }

  queueSarahApproval = async function(fromUser=false,runId=teamsState.runId){
    if(teamsState.approvalInProgress||teamsState.generating||teamsState.summaryReady||!teamsState.agentRecommendationReady)return;
    teamsState.approvalInProgress=true;
    if(!teamsState.authorised){
      if(!fromUser){teamsState.typing={kind:'message',initials:'SC',name:'Sarah Chen',role:'Campaign Manager'};teamsState.activeParticipant='SC';teamsState.activeParticipantStatus='Typing…';renderTeams();if(!await stableDelay(2100,runId))return;teamsState.typing=null;teamsState.messages.push({id:'approval-'+Date.now(),initials:'SC',name:'Sarah Chen',role:'Campaign Manager',time:'09:38',text:'Yes, please go ahead. Use this discussion as the starting context and review the relevant Teams conversations, Outlook emails and SharePoint documents before creating the initial iPortal campaign brief.',reactions:1,replies:[],humanConfirmation:true});}
      teamsState.authorised=true;
    }
    teamsState.approvalInProgress=false;teamsState.activeParticipant='SC';teamsState.activeParticipantStatus='Authorising campaign creation…';renderTeams();
    if(!await stableDelay(900,runId))return;
    teamsState.typing={kind:'message',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Campaign Specialist'};teamsState.activeParticipant='CA';teamsState.activeParticipantStatus='Acknowledging request…';renderTeams();if(!await stableDelay(1450,runId))return;
    teamsState.typing=null;if(!teamsState.messages.some(m=>m.id==='creation-ack'))teamsState.messages.push({id:'creation-ack',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Campaign Specialist',time:'09:39',text:'Understood. I’ll use the shared discussion context and review the connected sources before preparing the brief.',reactions:0,replies:[]});renderTeams();
    if(!await stableDelay(750,runId))return;
    teamsState.typing={kind:'message',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent'};teamsState.activeParticipant='AI';teamsState.activeParticipantStatus='Retaining campaign provenance…';renderTeams();if(!await stableDelay(1250,runId))return;
    teamsState.typing=null;if(!teamsState.messages.some(m=>m.id==='provenance-ack'))teamsState.provenanceReady=false;teamsState.provenanceReady=true;renderTeams();
    if(await stableDelay(650,runId))startTeamsCreation();
  };

  startTeamsCreation = async function(){
    if(teamsState.generating||teamsState.summaryReady||!teamsState.authorised)return;
    const runId=teamsState.runId;teamsState.generating=true;teamsState.thinkingStep=0;teamsState.activeParticipant='CA';renderTeams();
    for(let i=1;i<teamsState.thinkingStatuses.length;i++){if(!await stableDelay(1000,runId))return;teamsState.thinkingStep=i;teamsState.activeParticipantStatus=teamsState.thinkingStatuses[i];renderTeams();}
    if(!await stableDelay(1000,runId))return;teamsState.generating=false;teamsState.summaryReady=true;teamsState.sequenceRunning=false;teamsState.stableSequenceRunning=false;renderTeams();
  };

  runTeamsConversationSequence = async function(){
    if(teamsState.stableSequenceRunning||teamsState.summaryReady)return;
    const runId=++teamsState.runId;teamsState.stableSequenceRunning=true;teamsState.sequenceRunning=true;
    teamsState.systemEvents=[{text:'Campaign Coordinator was added to the iPortal Adoption channel.',time:'08:58'}];teamsState.activeParticipant='AI';teamsState.activeParticipantStatus='Added to channel';renderTeams();
    if(!await stableDelay(1250,runId))return;
    teamsState.typing={kind:'message',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent'};renderTeams();if(!await stableDelay(1850,runId))return;
    teamsState.typing=null;teamsState.messages.push({id:'agent-intro',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent',time:'08:59',text:'Hi everyone. I’ll follow the discussion, retain the key context and identify where specialist campaign support may be useful. I will bring in the appropriate agent if the conversation points to a campaign opportunity.',reactions:0,replies:[]});teamsState.agentIntroReady=true;teamsState.activeParticipantStatus='Following the discussion';renderTeams();
    if(!await stableDelay(1700,runId))return;
    for(let i=0;i<=5;i++)if(!await stableShowDiscussionItem(TEAMS_DISCUSSION[i],runId,i===0))return;
    if(!await stableDelay(1800,runId))return;
    teamsState.typing={kind:'message',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent'};teamsState.activeParticipant='AI';teamsState.activeParticipantStatus='Identifying specialist support…';renderTeams();if(!await stableDelay(2200,runId))return;
    teamsState.typing=null;teamsState.messages.push({id:'coordinator-opportunity',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent',time:'09:18',text:'I’m seeing a potential campaign opportunity. The team has identified a clear adoption problem, distinct behavioural cohorts and a need for coordinated activation. I’m bringing the Marketing Strategy & Campaign Brief Agent into the conversation to assess whether a structured campaign brief is the right next step.',reactions:1,replies:[]});teamsState.coordinatorOpportunityReady=true;renderTeams();
    if(!await stableDelay(1300,runId))return;teamsState.systemEvents.push({text:'Marketing Strategy & Campaign Brief Agent was added to the iPortal Adoption channel by Campaign Coordinator.',time:'09:19'});teamsState.creationAgentAdded=true;renderTeams();
    if(!await stableDelay(1100,runId))return;teamsState.systemEvents.push({text:'Campaign Coordinator shared the business problem, participant comments, audience hypotheses, channel considerations, evidence gaps and source references with Marketing Strategy & Campaign Brief Agent.',time:'09:20',context:true});teamsState.contextShared=true;renderTeams();
    if(!await stableDelay(1250,runId))return;teamsState.typing={kind:'message',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Campaign Specialist'};teamsState.activeParticipant='CA';teamsState.activeParticipantStatus='Context received';renderTeams();if(!await stableDelay(1950,runId))return;
    teamsState.typing=null;teamsState.creationAgentIntroReady=false;teamsState.creationAgentIntroReady=true;teamsState.activeParticipantStatus='Listening to the team';renderTeams();
    if(!await stableDelay(1600,runId))return;for(let i=6;i<TEAMS_DISCUSSION.length;i++)if(!await stableShowDiscussionItem(TEAMS_DISCUSSION[i],runId,false))return;
    if(!await stableDelay(2000,runId))return;teamsState.typing={kind:'message',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Campaign Specialist'};teamsState.activeParticipant='CA';teamsState.activeParticipantStatus='Assessing campaign opportunity…';renderTeams();if(!await stableDelay(2450,runId))return;
    teamsState.typing=null;teamsState.messages.push({id:'agent-recommendation',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Campaign Specialist',time:'09:36',agentRecommendation:true,reactions:0,replies:[]});teamsState.agentRecommendationReady=true;teamsState.activeParticipantStatus='Waiting for confirmation';renderTeams();
    if(!await stableDelay(5000,runId))return;if(!teamsState.authorised)await queueSarahApproval(false,runId);
  };

  window.pauseTeamsDiscussion = function(){
    if(teamsState.summaryReady)return;teamsState.paused=true;renderTeams();toast('Teams discussion paused');
  };
  window.resumeTeamsDiscussion = function(){
    if(!teamsState.paused)return;teamsState.paused=false;renderTeams();toast('Teams discussion resumed');
  };
  replayTeamsDiscussion = function(){
    teamsState.runId+=1;
    Object.assign(teamsState,{paused:false,generating:false,summaryReady:false,authorised:false,replyOpen:null,thinkingStep:0,messages:[],typing:null,systemEventShown:false,agentIntroReady:false,acknowledgementReady:false,agentRecommendationReady:false,sequenceRunning:false,stableSequenceRunning:false,approvalInProgress:false,reactionPulse:null,peopleOpen:false,activeParticipant:null,activeParticipantStatus:'',creationAgentAdded:false,contextShared:false,coordinatorOpportunityReady:false,creationAgentIntroReady:false,provenanceReady:false,systemEvents:[],_lastRenderedMessageCount:0,_lastSummaryReady:false});
    renderTeams();setTimeout(runTeamsConversationSequence,350);
  };



  /* ---------- V15 clean Option 2 final effective definitions ---------- */
  const IPORTAL_CREATIVE = window.IPORTAL_CREATIVE = '/assets/iportal-creative-single.png';
  state.briefTab = Number.isInteger(state.briefTab) ? state.briefTab : 0;
  state.briefShowAll = state.briefShowAll || {};
  state.commentFilter = state.commentFilter || 'all';

  /* Participant and ownership updates */
  const pJames=TEAMS_PARTICIPANTS.find(p=>p.initials==='JO');if(pJames){pJames.role='Head of GTB';pJames.defaultStatus='Available';}
  const pPriya=TEAMS_PARTICIPANTS.find(p=>p.initials==='PS');if(pPriya){pPriya.role='Data & Analytics';pPriya.defaultStatus='Available';}
  const pDaniel=TEAMS_PARTICIPANTS.find(p=>p.initials==='DR');if(pDaniel){pDaniel.role='Digital Propositions Head';pDaniel.defaultStatus='Available';pDaniel.presence='available';}
  const pCoordinator=TEAMS_PARTICIPANTS.find(p=>p.initials==='AI');if(pCoordinator){pCoordinator.role='AI Orchestration Agent';pCoordinator.defaultStatus='Available';}
  const pStrategy=TEAMS_PARTICIPANTS.find(p=>p.initials==='CA');if(pStrategy){pStrategy.name='Marketing Strategy & Campaign Brief Agent';pStrategy.role='AI Marketing Strategy Specialist';pStrategy.defaultStatus='Available';}
  if(!TEAMS_PARTICIPANTS.some(p=>p.initials==='CL'))TEAMS_PARTICIPANTS.unshift({id:'commercial-lead',initials:'CL',name:'Commercial Lead',role:'UKC Commercial',type:'human',presence:'available',defaultStatus:'Available'});
  state.production.forEach(p=>{if(p.channel==='LinkedIn')p.owner='Owned Channels';});
  teamsState.thinkingStatuses=['Reviewing shared context…','Checking connected sources…','Preparing the campaign brief…'];

  const CLEAN_TEAMS_DISCUSSION=[
    {type:'message',message:{id:'commercial-objective',initials:'CL',name:'Commercial Lead',role:'UKC Commercial',time:'09:00',text:'The key commercial objective is to deepen client relationships and increase product penetration across priority UKC clients, targeting £7.3m revenue uplift over the next 12 months.',reactions:2,replies:[]}},
    {type:'message',message:{id:'digital-proposition',initials:'DR',name:'Daniel Reed',role:'Digital Propositions Head',time:'09:04',text:'iPortal gives us a practical route to support that objective. The opportunity is to move clients from basic access toward broader use of payments, reporting and self-service capabilities already available in the platform.',reactions:1,replies:[]}},
    {type:'message',message:{id:'data-evidence',initials:'PS',name:'Priya Shah',role:'Data & Analytics',time:'09:08',text:'The behavioural data points to distinct groups rather than one broad audience: servicing-heavy clients, digitally dormant clients and established digital users with room to adopt more capabilities. We should segment by behaviour and validate the eligible population.',reactions:2,replies:[]}},
    {type:'message',message:{id:'gtb-outcome',initials:'JO',name:'James Okonkwo',role:'Head of GTB',time:'09:12',text:'That is the right direction. The marketing response should connect digital adoption back to stronger client relationships and broader product penetration, rather than treating iPortal usage as an isolated product metric.',reactions:2,replies:[]}},
    {type:'message',message:{id:'channel-strategy',initials:'SC',name:'Sarah Chen',role:'Campaign Manager',time:'09:16',text:'Email can directly activate known, marketable client contacts, while LinkedIn can extend reach to priority roles and audiences where owned-channel contactability is limited. Messaging should be tailored by audience, while maintaining a consistent core iPortal value proposition across channels.',reactions:3,replies:[]}},
    {type:'message',message:{id:'brand-constraint',initials:'HM',name:'Helen Marsh',role:'Brand Lead',time:'09:19',text:'Keep the £7.3m objective as the commercial target, but do not make quantified adoption or efficiency claims in market until the supporting baselines, consent and evidence are validated.',reactions:2,replies:[]}}
  ];

  teamsTypingCard = function(){
    const t=teamsState.typing;if(!t||t.kind!=='message')return '';
    const p=teamsParticipant(t.initials);
    return `<div class="teams-typing-card ${p.type==='agent'?'agent-typing':''}"><div class="teams-avatar ${p.type==='agent'?'agent':''}">${esc(p.initials)}</div><div class="teams-typing-copy"><strong>${esc(p.name)} is typing${teamsTypingDots()}</strong><span>${esc(p.role)}</span></div></div>`;
  };
  teamsReplyTyping = function(parentId){
    const t=teamsState.typing;if(!t||t.kind!=='reply'||t.parentId!==parentId)return '';
    const p=teamsParticipant(t.initials);
    return `<div class="teams-thread-typing ${p.type==='agent'?'agent-typing':''}"><div class="teams-avatar ${p.type==='agent'?'agent':''}">${esc(p.initials)}</div><div class="teams-thread-typing-copy"><strong>${esc(p.name)}</strong> is typing${teamsTypingDots()}</div></div>`;
  };

  renderTeamsPost = function(m){
    if(m.systemEvent)return `<div class="teams-system-event ${m.context?'context-share':''}"><span class="teams-system-event-icon">${m.context?'↗':'＋'}</span><span>${esc(m.text)}</span><time>${esc(m.time||'Now')}</time></div>`;
    const profile=teamsParticipant(m.initials);
    if(m.agentRecommendation){
      return `<article class="teams-post agent-post agent-message teams-agent-recommendation-post"><div class="teams-post-top"><div class="teams-avatar agent">${esc(profile.initials)}</div><div class="teams-author"><strong>${esc(profile.name)}</strong><span class="agent-badge">AI Agent</span><span>${esc(profile.role)} · ${esc(m.time)}</span></div></div>${renderTeamsRecommendation()}</article>`;
    }
    const thread=(m.replies&&m.replies.length)||teamsState.typing&&teamsState.typing.kind==='reply'&&teamsState.typing.parentId===m.id;
    return `<article class="teams-post ${profile.type==='agent'?'agent-message':''} ${m.humanConfirmation?'teams-human-confirmation':''}"><div class="teams-post-top"><div class="teams-avatar ${profile.type==='agent'?'agent':''}">${esc(profile.initials)}</div><div class="teams-author"><strong>${esc(profile.name)}</strong>${profile.type==='agent'?'<span class="agent-badge">AI Agent</span>':''}<span>${esc(profile.role)} · ${esc(m.time)}</span></div></div><p>${esc(m.text)}</p><div class="teams-post-actions"><button class="teams-mini-action teams-reaction ${teamsState.reactionPulse===m.id?'teams-reaction-pop':''}" onclick="reactTeams('${m.id}')">👍 <span>${m.reactions||0}</span></button><button class="teams-mini-action" onclick="toggleTeamReply('${m.id}')">Reply</button><button class="teams-mini-action">•••</button></div>${thread?`<div class="teams-thread">${(m.replies||[]).map(r=>{const rp=teamsParticipant(r.initials);return `<div class="teams-reply"><div class="teams-avatar ${rp.type==='agent'?'agent':''}">${esc(rp.initials)}</div><div class="teams-reply-body"><strong>${esc(rp.name)}</strong>${esc(r.text)}<span>${esc(r.time)}</span></div></div>`;}).join('')}${teamsReplyTyping(m.id)}</div>`:''}${teamsState.replyOpen===m.id?`<div class="teams-inline-reply"><input id="teamReply-${m.id}" placeholder="Reply in this thread…"><button onclick="postTeamReply('${m.id}')">Reply</button></div>`:''}</article>`;
  };

  function cleanParticipantStatus(p){
    const active=teamsParticipantActivity();
    if(active&&active.initials===p.initials)return active.status;
    if(p.type==='agent')return teamsState.summaryReady&&p.initials==='CA'?'Brief prepared':'Available';
    return p.defaultStatus||'Available';
  }

  renderTeamsPeople = function(){
    const panel=document.getElementById('teamsPeople');if(!panel)return;
    const backdrop=document.getElementById('teamsPeopleBackdrop');
    panel.classList.toggle('open',!!teamsState.peopleOpen);if(backdrop)backdrop.classList.toggle('open',!!teamsState.peopleOpen);
    const active=teamsParticipantActivity();
    const humans=TEAMS_PARTICIPANTS.filter(p=>p.type!=='agent');
    const agents=TEAMS_PARTICIPANTS.filter(p=>p.type==='agent');
    const row=p=>{const isActive=active&&active.initials===p.initials;return `<div class="teams-person ${isActive?'active':''} ${p.type==='agent'?'agent-row':''}" data-initials="${esc(p.initials)}"><div class="teams-person-avatar-wrap"><div class="teams-avatar ${p.type==='agent'?'agent':''}">${esc(p.initials)}</div><span class="teams-person-presence-dot ${p.presence==='away'?'away':p.presence==='offline'?'offline':''}"></span></div><div class="teams-person-copy"><strong>${esc(p.name)}</strong><span class="teams-person-role">${esc(p.role)}${p.type==='agent'?' · AI Agent':''}</span><span class="teams-person-status">${esc(cleanParticipantStatus(p))}</span></div></div>`;};
    panel.innerHTML=`<div class="teams-people-head"><div><h3>People in this discussion</h3><div class="teams-people-count">${TEAMS_PARTICIPANTS.length} participants</div></div><button class="teams-people-close" onclick="toggleTeamsPeople(false)">×</button></div><section class="teams-people-section"><div class="teams-people-section-title">People</div>${humans.map(row).join('')}</section><section class="teams-people-section teams-people-agent-group"><div class="teams-people-section-title">AI agents</div>${agents.map(row).join('')}</section>`;
  };

  renderTeamsRecommendation = function(){
    return `<p class="teams-opportunity-intro">The commercial objective, behavioural evidence and channel plan support a targeted iPortal campaign.</p><div class="teams-agent-question compact"><strong>Create the campaign brief?</strong> I’ll turn the agreed direction into a structured marketing strategy and campaign brief, grounded in the connected sources.</div><div class="teams-agent-actions"><button class="teams-agent-primary" onclick="approveCampaignCreation()">Yes, create the brief</button><button class="teams-agent-secondary" onclick="useTeamsPrompt()">Draft a response</button></div>`;
  };

  renderTeamsSummary = function(){
    return `<p>Campaign workspace prepared from the UKC Pod discussion and connected sources.</p><div class="teams-summary-card"><div class="teams-summary-head"><strong>iPortal Digital Engagement Campaign</strong><span>Brief ready</span></div><div class="teams-summary-body"><div class="teams-summary-grid"><div class="teams-summary-item"><label>Commercial objective</label><div>Deepen priority UKC relationships and support £7.3m revenue uplift.</div></div><div class="teams-summary-item"><label>Priority audiences</label><div>Servicing-heavy, digitally dormant and advanced digital users.</div></div><div class="teams-summary-item"><label>Channels</label><div>Email activation + LinkedIn reach.</div></div><div class="teams-summary-item"><label>Open evidence</label><div>Eligible population, baselines, consent and quantified claims.</div></div></div><button class="teams-open-brief" onclick="openCampaignStudioFromTeams()"><span>Open campaign brief</span><span>→</span></button></div></div>`;
  };

  renderTeams = function(){
    ensurePlaybackControls();
    const feed=document.getElementById('teamsFeedInner');if(!feed)return;
    const defs=[];
    (teamsState.systemEvents||[]).forEach((e,i)=>defs.push({key:'event-'+i+'-'+hashText(e.text),html:`<div class="teams-system-event ${e.context?'context-share':''}"><span class="teams-system-event-icon">${e.context?'↗':'＋'}</span><span>${esc(e.text)}</span><time>${esc(e.time||'Now')}</time></div>`}));
    teamsState.messages.forEach((m,i)=>defs.push({key:'message-'+(m.id||('system-'+i+'-'+hashText(m.text||''))),html:renderTeamsPost(m)}));
    if(teamsState.typing&&teamsState.typing.kind==='message')defs.push({key:'typing-main',html:teamsTypingCard()});
    if(teamsState.generating)defs.push({key:'agent-generation',html:`<div class="teams-post agent-post agent-message"><div class="teams-post-top"><div class="teams-avatar agent">CA</div><div class="teams-author"><strong>Marketing Strategy & Campaign Brief Agent</strong><span class="agent-badge">AI Agent</span><span>AI Marketing Strategy Specialist</span></div></div><p>${esc(teamsState.thinkingStatuses[teamsState.thinkingStep])} ${teamsTypingDots()}</p></div>`});
    else if(teamsState.summaryReady)defs.push({key:'agent-summary',html:`<div class="teams-post agent-post agent-message"><div class="teams-post-top"><div class="teams-avatar agent">CA</div><div class="teams-author"><strong>Marketing Strategy & Campaign Brief Agent</strong><span class="agent-badge">AI Agent</span><span>AI Marketing Strategy Specialist · ready</span></div></div>${renderTeamsSummary()}</div>`});
    const existing=new Map([...feed.children].map(el=>[el.dataset.stableKey,el]));
    defs.forEach(def=>{const sig=hashText(def.html);let node=existing.get(def.key);if(!node){node=document.createElement('div');node.className='teams-stable-item';node.dataset.stableKey=def.key;node.dataset.signature=sig;node.innerHTML=def.html;}else if(node.dataset.signature!==sig){node.dataset.signature=sig;node.innerHTML=def.html;}feed.appendChild(node);existing.delete(def.key);});existing.forEach(node=>node.remove());
    const chip=document.getElementById('teamsAgentChip');if(chip)chip.textContent=teamsState.paused?'Discussion paused':teamsState.generating?'Preparing brief':teamsState.summaryReady?'Campaign brief prepared':'Campaign support active';
    const pause=document.getElementById('teamsPauseButton'),resume=document.getElementById('teamsResumeButton');if(pause)pause.disabled=teamsState.paused||teamsState.summaryReady;if(resume)resume.disabled=!teamsState.paused||teamsState.summaryReady;
    renderTeamsPeople();
    const count=teamsState.messages.length+(teamsState.systemEvents||[]).length;const meaningfulNew=count>teamsState._lastRenderedMessageCount||(!teamsState._lastSummaryReady&&teamsState.summaryReady);teamsState._lastRenderedMessageCount=count;teamsState._lastSummaryReady=teamsState.summaryReady;if(meaningfulNew)requestAnimationFrame(()=>{const c=document.getElementById('teamsFeed');if(c)c.scrollTo({top:c.scrollHeight,behavior:'smooth'});});
  };

  runTeamsConversationSequence = async function(){
    if(teamsState.stableSequenceRunning||teamsState.summaryReady)return;
    const runId=++teamsState.runId;teamsState.stableSequenceRunning=true;teamsState.sequenceRunning=true;teamsState.systemEvents=[];
    teamsState.typing={kind:'message',initials:'CL',name:'Commercial Lead',role:'UKC Commercial'};teamsState.activeParticipant='CL';teamsState.activeParticipantStatus='Sharing strategy outcome…';renderTeams();
    if(!await stableDelay(1200,runId))return;teamsState.typing=null;teamsState.messages.push(cloneTeamsValue(CLEAN_TEAMS_DISCUSSION[0].message));teamsState.activeParticipant='CL';teamsState.activeParticipantStatus='Commercial objective shared';renderTeams();
    if(!await stableDelay(1100,runId))return;teamsState.systemEvents.push({text:'Campaign Coordinator joined the iPortal Adoption discussion.',time:'09:01'});renderTeams();
    if(!await stableDelay(700,runId))return;teamsState.typing={kind:'message',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent'};teamsState.activeParticipant='AI';teamsState.activeParticipantStatus='Typing…';renderTeams();
    if(!await stableDelay(1350,runId))return;teamsState.typing=null;teamsState.messages.push({id:'agent-intro',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent',time:'09:02',text:'Hi everyone. I’ll follow the discussion, retain the key context and identify where specialist campaign support may be useful. I will bring in the appropriate agents based on the conversation.',reactions:0,replies:[]});teamsState.agentIntroReady=true;teamsState.activeParticipantStatus='Available';renderTeams();
    for(let i=1;i<CLEAN_TEAMS_DISCUSSION.length;i++)if(!await stableShowDiscussionItem(CLEAN_TEAMS_DISCUSSION[i],runId,false))return;
    if(!await stableDelay(1200,runId))return;teamsState.typing={kind:'message',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent'};teamsState.activeParticipant='AI';teamsState.activeParticipantStatus='Identifying specialist support…';renderTeams();
    if(!await stableDelay(1400,runId))return;teamsState.typing=null;teamsState.messages.push({id:'coordinator-opportunity',initials:'AI',name:'Campaign Coordinator',role:'AI Orchestration Agent',time:'09:21',text:'I’m seeing a potential campaign opportunity. I’ll bring in the appropriate agent.',reactions:1,replies:[]});teamsState.coordinatorOpportunityReady=true;renderTeams();
    if(!await stableDelay(800,runId))return;teamsState.systemEvents.push({text:'Marketing Strategy & Campaign Brief Agent joined the discussion.',time:'09:22'});teamsState.creationAgentAdded=true;renderTeams();
    if(!await stableDelay(650,runId))return;teamsState.systemEvents.push({text:'Relevant discussion context shared with Marketing Strategy & Campaign Brief Agent.',time:'09:22',context:true});teamsState.contextShared=true;renderTeams();
    if(!await stableDelay(700,runId))return;teamsState.typing={kind:'message',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Marketing Strategy Specialist'};teamsState.activeParticipant='CA';teamsState.activeParticipantStatus='Assessing campaign opportunity…';renderTeams();
    if(!await stableDelay(1250,runId))return;teamsState.typing=null;teamsState.messages.push({id:'agent-recommendation',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Marketing Strategy Specialist',time:'09:23',agentRecommendation:true,reactions:0,replies:[]});teamsState.agentRecommendationReady=true;teamsState.activeParticipantStatus='Waiting for confirmation';renderTeams();
    if(!await stableDelay(3800,runId))return;if(!teamsState.authorised)await queueSarahApproval(false,runId);
  };

  queueSarahApproval = async function(fromUser=false,runId=teamsState.runId){
    if(teamsState.approvalInProgress||teamsState.generating||teamsState.summaryReady||!teamsState.agentRecommendationReady)return;
    teamsState.approvalInProgress=true;
    if(!teamsState.authorised){
      if(!fromUser){teamsState.typing={kind:'message',initials:'SC',name:'Sarah Chen',role:'Campaign Manager'};teamsState.activeParticipant='SC';teamsState.activeParticipantStatus='Typing…';renderTeams();if(!await stableDelay(1500,runId))return;teamsState.typing=null;teamsState.messages.push({id:'approval-'+Date.now(),initials:'SC',name:'Sarah Chen',role:'Campaign Manager',time:'09:24',text:'Yes, please go ahead. Use the UKC Pod discussion as the starting context and review the relevant Teams, Outlook and SharePoint sources before preparing the iPortal campaign brief.',reactions:1,replies:[],humanConfirmation:true});}
      teamsState.authorised=true;
    }
    teamsState.approvalInProgress=false;renderTeams();
    if(!await stableDelay(600,runId))return;teamsState.typing={kind:'message',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Marketing Strategy Specialist'};teamsState.activeParticipant='CA';teamsState.activeParticipantStatus='Acknowledging request…';renderTeams();
    if(!await stableDelay(1000,runId))return;teamsState.typing=null;if(!teamsState.messages.some(m=>m.id==='creation-ack'))teamsState.messages.push({id:'creation-ack',initials:'CA',name:'Marketing Strategy & Campaign Brief Agent',role:'AI Marketing Strategy Specialist',time:'09:25',text:'Understood. I’ll review the connected sources and prepare the brief.',reactions:0,replies:[]});teamsState.activeParticipantStatus='Available';renderTeams();
    if(await stableDelay(450,runId))startTeamsCreation();
  };

  startTeamsCreation = async function(){
    if(teamsState.generating||teamsState.summaryReady||!teamsState.authorised)return;
    const runId=teamsState.runId;teamsState.generating=true;teamsState.thinkingStep=0;teamsState.activeParticipant='CA';teamsState.activeParticipantStatus=teamsState.thinkingStatuses[0];renderTeams();
    for(let i=1;i<teamsState.thinkingStatuses.length;i++){if(!await stableDelay(850,runId))return;teamsState.thinkingStep=i;teamsState.activeParticipantStatus=teamsState.thinkingStatuses[i];renderTeams();}
    if(!await stableDelay(850,runId))return;teamsState.generating=false;teamsState.summaryReady=true;teamsState.sequenceRunning=false;teamsState.stableSequenceRunning=false;teamsState.activeParticipantStatus='Brief prepared';renderTeams();
  };

  useTeamsPrompt = function(){const input=document.getElementById('teamsComposer');if(!input)return;input.value='Yes, please go ahead. Use the UKC Pod discussion as the starting context and review the relevant Teams, Outlook and SharePoint sources before preparing the iPortal campaign brief.';input.focus();};

  /* ---------- campaign workflow visual simplification ---------- */
  stageHeader = function(i,title,desc){return `<div class="stage-banner"><div><div class="eyebrow">Stage ${i+1} of ${stages.length}</div><h2>${esc(title)}</h2>${desc?`<p>${esc(desc)}</p>`:''}</div><span class="status-chip ${state.completed.has(i)?'complete':''}">${state.completed.has(i)?'Completed':'In progress'}</span></div>`;};

  renderAcceptedAsset = function(i){
    const rec=state.acceptedAssets[i];if(!rec)return renderSavingState(i);
    const def=assetDef(i), next=def.nextStageIndex;
    return `<div class="clean-accepted"><div><strong>${esc(def.name)} accepted</strong><span> · ${esc(rec.id)}</span></div><div style="display:flex;align-items:center;gap:7px"><span class="asset-id-pill">${esc(rec.id)}</span>${next!==null&&state.stage<=i?`<button class="btn primary" onclick="prepareNextStagePrompt(${i})">Next: ${esc(def.nextStageLabel)}</button>`:''}</div></div>`;
  };

  const CLEAN_BRIEF_TABS=[
    {label:'Business Need',refs:briefSections[0].fields.map((_,fi)=>[0,fi])},
    {label:'Detail & Tactics',keys:['insight','painPoints','qualObjectives','cta','architecture','tactics','budget','timings']},
    {label:'Audience & Channels',keys:['persona','attributes','priorInsights','channels','media','audienceMessaging','assets']},
    {label:'Measurement',keys:['quantObjectives','kpis','measurement','development','integration','reporting']}
  ];
  function briefRefsForTab(tab){
    const cfg=CLEAN_BRIEF_TABS[tab];if(cfg.refs)return cfg.refs;
    const refs=[];briefSections.forEach((sec,si)=>sec.fields.forEach((f,fi)=>{if(cfg.keys.includes(f[0]))refs.push([si,fi]);}));return refs;
  }
  window.setBriefTab=function(i){state.briefTab=i;renderAll();};
  window.toggleBriefShowAll=function(i){state.briefShowAll[i]=!state.briefShowAll[i];renderAll();};
  window.openBriefFieldEditor=function(si,fi){
    const f=briefSections[si].fields[fi];document.getElementById('modalRoot').innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>Edit ${esc(f[1])}</h2><div class="field"><textarea id="cleanBriefEdit" rows="6">${esc(f[2])}</textarea></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveBriefFieldEditor(${si},${fi})">Save</button></div></div></div>`;
  };
  window.saveBriefFieldEditor=function(si,fi){
    const el=document.getElementById('cleanBriefEdit');if(!el)return;const f=briefSections[si].fields[fi],before=f[2],after=el.value.trim();if(after&&after!==before){archiveDownstream(1,'Campaign brief edited',{label:f[1],before});f[2]=after;state.briefVersion+=1;state.lastBriefInstruction='Updated '+f[1]+'.';}closeModal();renderAll();
  };
  window.focusBriefRefine=function(){const input=document.getElementById('composerInput');if(input){input.value='Refine the campaign brief while preserving the approved commercial objective and source grounding.';input.focus();}};

  renderBrief = function(){
    const tab=Math.min(3,Math.max(0,state.briefTab||0)),refs=briefRefsForTab(tab),showAll=!!state.briefShowAll[tab],visible=showAll?refs:refs.slice(0,5),selectedComments=state.comments.filter(c=>c.selected&&!c.incorporated).length;
    return `${stageHeader(1,'Complete campaign brief','Commercial strategy translated into an editable campaign brief.')}<p class="answer-intro">The brief connects the £7.3m commercial objective to audience, channel and measurement choices for iPortal.</p><div class="clean-grounding"><strong>Grounded in:</strong> UKC Pod discussion, SharePoint campaign material, Teams messaging context and Outlook roadmap evidence.</div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${ICON.file}${esc(state.campaignName)}</div><div class="clean-brief-meta">${state.briefId?`<span class="brief-id">${esc(state.briefId)}</span>`:''}<span class="clean-badge ${state.briefId?'success':'blue'}">v${state.briefVersion}.0 · ${state.briefId?'Accepted':'Draft'}</span><button class="collaborator-trigger" onclick="openComments()"><span class="comment-count">${state.comments.length}</span> Comments</button><button class="mini-btn" onclick="openVersions()">•••</button></div></div><div class="artifact-body"><div class="clean-brief-tabs">${CLEAN_BRIEF_TABS.map((t,i)=>`<button class="clean-brief-tab ${i===tab?'active':''}" onclick="setBriefTab(${i})">${i+1}. ${esc(t.label)}</button>`).join('')}</div><div class="clean-brief-head"><h4>${esc(CLEAN_BRIEF_TABS[tab].label)}</h4><span class="clean-badge success">${refs.length} fields</span></div><div class="clean-field-grid">${visible.map(([si,fi],idx)=>{const f=briefSections[si].fields[fi],wide=idx===2||f[2].length>170;return `<div class="clean-field-card ${wide?'wide':''}"><label>${esc(f[1])}</label><p>${esc(f[2])}</p><button class="clean-edit-icon" onclick="openBriefFieldEditor(${si},${fi})" title="Edit">✎</button></div>`;}).join('')}</div>${refs.length>5?`<div class="clean-view-more"><button class="btn" onclick="toggleBriefShowAll(${tab})">${showAll?'Show key fields':'View all '+refs.length+' fields'}</button></div>`:''}${state.lastBriefInstruction?`<div class="clean-compact-callout">Latest update: ${esc(state.lastBriefInstruction)}</div>`:''}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn secondary-light" onclick="openComments()">Comments${selectedComments?' · '+selectedComments+' selected':''}</button><button class="btn secondary-light" onclick="focusBriefRefine()">Refine brief</button><button class="btn primary" ${state.acceptedAssets[1]||state.generatingStage!==null||state.savingStage!==null?'disabled':''} onclick="acceptBrief()">${state.acceptedAssets[1]?'Accepted':'Accept & continue'}</button></div>${renderInlineOperation(1)}</div></div>`;
  };

  renderSegments = function(){
    const selected=state.segments.filter(x=>x.selected),total=state.segments.reduce((a,b)=>a+b.count,0);
    return `${stageHeader(2,'Audience segmentation','Prioritise deterministic audiences and reveal detail only when needed.')}<p class="answer-intro">Prioritise Self-Service Opportunity and Digital Adoption; both have clear behavioural barriers the campaign can address.</p><div class="clean-summary-row"><div class="clean-summary-stat"><strong>${state.segments.length}</strong><span>Segments</span></div><div class="clean-summary-stat"><strong>${total.toLocaleString('en-GB')}</strong><span>Total CSIDs</span></div><div class="clean-summary-stat"><strong>${selected.reduce((a,b)=>a+b.count,0).toLocaleString('en-GB')}</strong><span>Selected audience</span></div></div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(2)}Audience segments</div>${renderAssetHeaderRight(2,selected.length+' selected')}</div><div class="artifact-body"><div class="clean-list">${state.segments.map((s,i)=>`<div class="clean-row"><div class="clean-row-main"><input class="clean-check" type="checkbox" ${s.selected?'checked':''} onchange="toggleSegment(${i})"><div class="clean-row-copy"><strong>${esc(s.name)}</strong><span>${s.count.toLocaleString('en-GB')} CSIDs · ${esc(s.channel)}</span></div><span class="clean-badge ${s.active==='Yes'?'success':'warning'}">${esc(s.active==='Yes'?'Activatable':'Review')}</span></div><div class="clean-row-note">${esc(s.why)}</div><details class="clean-expand"><summary>View rules, suppressions and collaboration</summary><div class="clean-expand-body"><p><strong>Eligibility:</strong> ${esc(s.rule)}</p><p><strong>Need:</strong> ${esc(s.needs)}</p><p><strong>Suppressions:</strong> ${(s.suppressions||[]).map(esc).join(' · ')}</p><div class="clean-inline-actions"><button class="btn" onclick="openSegmentComments(${i})">Comments (${(s.comments||[]).length})</button><button class="btn" onclick="cloneSegment(${i})">Clone</button></div></div></details></div>`).join('')}</div>${state.addSegmentOpen?renderAddSegmentForm():''}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="addSegment()">Add segment</button><button class="btn primary" ${selected.length?'':'disabled'} onclick="acceptStageAsset(2,'Audience segment set')">Accept ${selected.length} segments</button></div>${renderInlineOperation(2)}</div></div>`;
  };

  renderApproval = function(){
    const segs=state.segments.filter(s=>s.selected).map(s=>s.name).join(', '),rec=state.acceptedAssets[3],processing=state.approvalSubmitting||state.savingStage===3;
    return `${stageHeader(3,'Brief approval','Route the agreed strategy and audience decisions through Adobe Workfront.')}<div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(3)}Approval summary</div>${renderAssetHeaderRight(3,rec?(rec.decision||'Approved'):'Awaiting approval')}</div><div class="artifact-body"><div class="approval-summary-grid"><div class="approval-summary-item"><label>Commercial objective</label><span>Deepen UKC relationships · £7.3m revenue uplift target</span></div><div class="approval-summary-item"><label>Selected audiences</label><span>${esc(segs)}</span></div><div class="approval-summary-item"><label>Channels</label><span>Email · LinkedIn</span></div><div class="approval-summary-item"><label>Budget / timing</label><span>£310,102 · September launch</span></div></div><div class="clean-compact-callout"><strong>Conditions:</strong> ${esc(state.approvalConditions)}</div><div class="clean-list"><div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>James Okonkwo — Head of GTB</strong><span>Strategy, scope and investment</span></div><span class="clean-badge ${rec?'success':'warning'}">${rec?'Approved':'Pending'}</span></div></div><div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>Helen Marsh — Brand Lead</strong><span>Claims, evidence gaps and mandatory constraints</span></div><span class="clean-badge ${rec?'success':'warning'}">${rec?'Approved with conditions':'Pending'}</span></div></div></div>${rec?`<details class="clean-expand"><summary>View approval record</summary><div class="clean-expand-body"><p><strong>Approval ID:</strong> ${esc(rec.id)} · <strong>Workfront:</strong> ${esc(rec.workfrontReference||state.workfrontReference||'Recorded')}</p><p><strong>Decision:</strong> ${esc(rec.decision||'Approved')}</p></div></details>`:''}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="openAssetComments(3)">Comments</button><button class="btn primary" ${processing||rec?'disabled':''} onclick="openBriefApprovalModal()">${rec?'Approved':'Route in Workfront'}</button></div>${processing?`<div class="approval-processing-state"><div class="approval-processing-spinner"></div><div class="approval-processing-copy"><strong>${esc(state.savingLabel||'Routing approval…')}</strong><span>Creating the Workfront governance record.</span></div></div>`:''}${renderInlineOperation(3)}</div></div>`;
  };

  renderProduction = function(){
    const active=state.production.filter(x=>!x.removed);
    return `${stageHeader(4,'Production plan','Turn the approved strategy into channel work packages.')}<p class="answer-intro">${active.length} work packages are ready across Email and LinkedIn.</p><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(4)}Channel work packages</div>${renderAssetHeaderRight(4,active.length+' active')}</div><div class="artifact-body"><div class="clean-list">${state.production.map((p,i)=>`<div class="clean-row" style="${p.removed?'opacity:.5':''}"><div class="clean-row-main"><div class="clean-row-copy"><strong>${esc(p.channel)} — ${esc(p.asset)}</strong><span>${esc(p.audience)} · ${esc(p.owner)} · ${esc(p.timing)}</span></div><span class="clean-badge ${p.removed?'warning':'blue'}">${p.removed?'Excluded':'Ready'}</span></div><details class="clean-expand"><summary>View requirement and controls</summary><div class="clean-expand-body"><p><strong>Requirement:</strong> ${esc(p.message)}</p><p><strong>Format:</strong> ${esc(p.format)}</p><div class="clean-inline-actions"><button class="btn" onclick="openSubAssetComments(4,'production-${p.id}','${esc(p.channel+' · '+p.asset)}')">Comments</button><button class="btn" onclick="toggleProduction(${i})">${p.removed?'Restore':'Remove'}</button></div></div></details></div>`).join('')}</div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="toast('Workfront work packages created')">Create Workfront tasks</button><button class="btn primary" onclick="acceptStageAsset(4,'Production plan')">Accept production plan</button></div>${renderInlineOperation(4)}</div></div>`;
  };

  // A slot renders the image its own record owns. Borrowing another channel's creative would
  // misrepresent an unmatched requirement as a real DAM match, so the gap is shown instead.
  function missingCreativePreview(a){
    const label = (a&&(a.requirement||a.name))||'this channel slot';
    return `<div class="clean-creative is-missing" role="img" aria-label="No creative available for ${esc(label)}"><small>Creative required</small><strong>${esc((a&&a.dimensions)||'')}</strong><span>Regenerate creative to create this channel asset</span></div>`;
  }
  window.missingCreativePreview = missingCreativePreview;
  // Sources are now sized for their own channel, so the pane fits them with a plain
  // centred cover instead of the old 200%-wide anchored crop.
  damPreview = function(a){
    if(!a) return '';
    if(!a.imageUrl) return missingCreativePreview(a);
    return `<div class="clean-creative asset-crop-full" style="background-image:url('${esc(a.imageUrl)}')" aria-label="${esc(a.name||'Creative preview')}"></div>`;
  };
  renderDamResult = function(a,i){
    const selected=a.included,created=a.generated||a.adapted,statusClass=a.matchStatus==='Reusable'?'success':'warning';
    return `<div class="clean-dam-result ${selected?'selected':''}" id="dam-result-${i}">${damPreview(a)}<div><div class="clean-dam-title"><div><h4>${esc(a.requirement)}</h4><p>${esc(a.id)} · ${esc(a.name)}</p></div><label class="asset-choice"><input type="checkbox" ${selected?'checked':''} onchange="toggleAsset(${i})"> Select</label></div><div class="tag-row"><span class="clean-badge ${statusClass}">${esc(a.matchStatus)}</span><span class="clean-badge blue">${esc(a.confidence)}</span></div><div class="clean-dam-recommendation"><strong>Recommendation:</strong> ${esc(a.matchReason)}</div>${state.damGeneratingId===a.id?`<div class="genstudio-inline"><div class="genstudio-mark">Gs</div><div><strong>Preparing adaptation ${teamsTypingDots()}</strong><span>Using the supplied Barclays iPortal creative as the source.</span></div></div>`:''}<details class="clean-expand"><summary>View metadata and actions</summary><div class="clean-expand-body"><p><strong>Format:</strong> ${esc(a.format)} · ${esc(a.dimensions)}</p><p><strong>Approval:</strong> ${esc(a.approval)} · <strong>Rights:</strong> ${esc(a.rights)}</p><p><strong>Lineage:</strong> ${a.adapted?`Adobe DAM ${esc(a.sourceAssetId||a.id)} → Adobe GenStudio ${esc(a.jobId)}`:a.generated?`Adobe GenStudio · ${esc(a.jobId)}`:a.found?`Adobe DAM · ${esc(a.id)}`:'Campaign requirement · no DAM match'}</p>${externalStatusMarkup(a)}<div class="clean-inline-actions">${a.found&&!a.generated?`<button class="btn" onclick="previewDamAsset(${i})">Preview</button><button class="btn" onclick="openGenStudioRequest(${i},'modify')">Modify in GenStudio</button>`:`<button class="btn" onclick="openGenStudioRequest(${i},'create')">${created?'Request another version':'Create in GenStudio'}</button>`}${created?`<button class="btn" onclick="openExternalApprovalRequest('asset','${i}')">Agency review</button>`:''}<button class="btn" onclick="openSubAssetComments(5,'${esc(a.commentsKey)}','${esc(a.requirement.replace(/'/g,"\\'"))}')">Comments</button></div></div></details></div></div>`;
  };
  renderAssets = function(){
    const selected=state.assets.filter(x=>x.included),reusable=state.assets.filter(x=>x.matchStatus==='Reusable').length,adapt=state.assets.filter(x=>x.matchStatus==='Adaptation recommended').length,gaps=state.assets.filter(x=>x.matchStatus.includes('No suitable')).length;
    return `${stageHeader(5,'Adobe DAM asset search','Compare reusable content, adaptations and creation gaps.')}<div class="clean-summary-row"><div class="clean-summary-stat"><strong>46</strong><span>Reviewed</span></div><div class="clean-summary-stat"><strong>${reusable}</strong><span>Reuse</span></div><div class="clean-summary-stat"><strong>${adapt}</strong><span>Adapt</span></div><div class="clean-summary-stat"><strong>${gaps}</strong><span>Create</span></div></div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(5)}Recommended assets</div>${renderAssetHeaderRight(5,selected.length+' selected')}</div><div class="artifact-body"><div class="clean-list">${state.assets.map(renderDamResult).join('')}</div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="toggleDamCriteria()">Search criteria</button><button class="btn primary" ${selected.length?'':'disabled'} onclick="acceptStageAsset(5,'Asset-selection package')">Accept ${selected.length} selected</button></div>${renderInlineOperation(5)}</div></div>`;
  };

  renderOutputPreview = function(o){return `<div class="clean-output-preview"><div class="clean-creative asset-crop-full" style="background-image:url('${IPORTAL_CREATIVE}')"></div><div class="clean-output-copy"><h4>${esc(o.headline)}</h4><p>${esc(o.body)}</p><p class="cta">${esc(o.cta)} →</p></div></div>`;};
  renderOutputCard = function(key,o){
    const busy=state.outputGeneratingKey===key||state.outputSavingKey===key;
    return `<div class="clean-row" id="output-card-${key}" style="${o.excluded?'opacity:.5':''}"><div class="clean-row-main"><div class="clean-row-copy"><strong>${esc(o.label)}</strong><span>${esc(o.channel)} · v${o.version}.0 · ${esc(o.audience)}</span></div><span class="clean-badge ${o.approved?'success':'blue'}">${o.approved?'Accepted':'Draft'}</span></div><div style="margin-top:9px">${renderOutputPreview(o)}</div>${state.outputGeneratingKey===key?`<div class="genstudio-inline"><div class="genstudio-mark">Gs</div><div><strong>Preparing revision ${teamsTypingDots()}</strong><span>Current output remains visible.</span></div></div>`:''}${externalStatusMarkup(o)}<details class="clean-expand"><summary>View technical details and more actions</summary><div class="clean-expand-body"><p><strong>Format:</strong> ${esc(o.format)} · ${esc(o.dimensions)}</p><p><strong>Source:</strong> ${esc(o.sourceAssetIds.join(', '))}</p><p><strong>Tracking:</strong> ${esc(o.tracking)}</p><p><strong>Accessibility:</strong> ${esc(o.accessibility)}</p><div class="clean-inline-actions"><button class="btn" ${busy?'disabled':''} onclick="openOutputEdit('${key}')">Edit</button><button class="btn" ${busy?'disabled':''} onclick="openSubAssetComments(6,'${esc(o.commentsKey)}','${esc(o.label.replace(/'/g,"\\'"))}')">Comments</button><button class="btn" ${busy?'disabled':''} onclick="openExternalApprovalRequest('output','${key}')">Agency review</button><button class="btn danger" ${busy?'disabled':''} onclick="excludeOutput('${key}')">${o.excluded?'Restore':'Exclude'}</button></div></div></details><div class="clean-inline-actions"><button class="btn" onclick="previewOutput('${key}')">Preview</button><button class="btn" ${busy?'disabled':''} onclick="openOutputRevision('${key}')">Request changes</button><button class="btn primary" ${busy||o.approved?'disabled':''} onclick="acceptOutput('${key}')">${o.approved?'Accepted':'Accept output'}</button></div></div>`;
  };
  renderOutputs = function(){
    const active=Object.entries(state.outputs).filter(([,o])=>!o.excluded),approved=active.filter(([,o])=>o.approved);
    return `${stageHeader(6,'Channel outputs','Review the Email and LinkedIn executions created from the approved strategy.')}<p class="answer-intro">Channel-ready outputs retain the supplied Barclays iPortal creative while adapting copy and format for each audience.</p><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(6)}Channel outputs</div>${renderAssetHeaderRight(6,approved.length+' accepted')}</div><div class="artifact-body"><div class="clean-list">${Object.entries(state.outputs).map(([k,o])=>renderOutputCard(k,o)).join('')}</div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="toast('Technical details opened')">Technical details</button><button class="btn primary" ${approved.length?'':'disabled'} onclick="acceptStageAsset(6,'Channel output package')">Accept output package</button></div>${renderInlineOperation(6)}</div></div>`;
  };

  renderLaunch = function(){
    const approved=Object.entries(state.outputs).filter(([,v])=>v.approved),agencyRows=[...state.assets.filter(a=>a.included&&(a.generated||a.adapted)).map(a=>({name:a.requirement,status:a.externalApprovalStatus||'Not requested'})),...approved.map(([,o])=>({name:o.label,status:o.externalApprovalStatus||'Not requested'}))],waiting=agencyRows.filter(r=>/Awaiting|Preparing|Reapproval/.test(r.status)).length;
    const readiness=[['Audience lists','Ready'],['Brief approval',state.acceptedAssets[3]?'Ready':'Needs attention'],['Channel outputs',approved.length?'Ready':'Needs attention'],['Tracking','Ready'],['Agency review',waiting?'Needs attention':'Ready']];
    return `${stageHeader(7,'Launch handoff','Confirm readiness and destination handoff.')}<div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(7)}Launch readiness</div>${renderAssetHeaderRight(7,state.published?'Published':waiting?'Needs attention':'Ready')}</div><div class="artifact-body"><div class="clean-list">${readiness.map(([name,status])=>`<div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>${esc(name)}</strong></div><span class="clean-badge ${status==='Ready'?'success':'warning'}">${esc(status)}</span></div></div>`).join('')}</div><div class="answer-section"><h3>Destinations</h3><div class="clean-list">${approved.map(([key,v])=>`<div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>${esc(v.label)}</strong><span>${key==='email'?'CRM / ESP':'LinkedIn'}</span></div><span class="clean-badge success">${state.published?'Published':'Queued'}</span></div></div>`).join('')}<div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>GA4 / campaign dashboard</strong><span>Measurement handoff</span></div><span class="clean-badge success">${state.published?'Configured':'Queued'}</span></div></div></div></div>${state.published?`<div class="clean-accepted"><strong>Mock publish complete</strong><span>Campaign package and audit history are ready.</span></div>`:''}</div><div class="artifact-actions"><div class="clean-primary-actions">${state.published?`<button class="btn" onclick="exportState()">Export</button><button class="btn" onclick="toast('Audit trail opened')">Audit</button>`:`<button class="btn" onclick="holdLaunch()">Hold</button><button class="btn primary" onclick="publishCampaign(${waiting?'true':'false'})">${waiting?'Approve with conditions':'Confirm publish'}</button>`}</div>${renderInlineOperation(7)}</div></div>`;
  };

  /* ---------- compact collaborator panel ---------- */
  renderCommentsPanel = function(){
    const data=activeCommentData(),comments=data.comments,selected=comments.filter(c=>c.selected&&!c.incorporated).length;
    const isSegment=state.commentAsset.type==='segment',isStage=state.commentAsset.type==='stage',isSub=state.commentAsset.type==='subasset';
    const generateAction=isSegment?'applySegmentComments()':isStage?`applyStageComments(${state.commentAsset.index})`:isSub?'applySubAssetComments()':'regenerateFromComments()';
    document.getElementById('rightPanel').innerHTML=`<div class="clean-comments-head"><h3>Comments</h3><div class="clean-comments-tools"><select class="clean-comments-filter"><option>All</option><option>Open</option></select><button class="comments-close" onclick="closeComments()">×</button></div></div>${comments.map((c,i)=>`<div class="clean-comment ${c.incorporated?'incorporated':''}"><div class="clean-comment-top"><div class="clean-comment-avatar">${esc(c.initials)}</div><div class="clean-comment-author"><strong>${esc(c.name)}</strong><span>${esc(c.time)}</span></div></div><div class="clean-comment-text">${esc(c.text)}</div><div class="clean-comment-location">${esc(c.location)}</div><div class="clean-comment-actions"><button class="clean-comment-link ${c.selected?'selected':''}" ${c.incorporated?'disabled':''} onclick="toggleComment(${i})">${c.incorporated?'✓ Used':c.selected?'✓ Included':'Include'}</button><button class="clean-comment-link" onclick="document.getElementById('replyDetails-${i}').open=true;document.getElementById('reply-${i}')?.focus()">Reply</button></div><details class="clean-replies" id="replyDetails-${i}"><summary>${(c.replies||[]).length} repl${(c.replies||[]).length===1?'y':'ies'}</summary>${(c.replies||[]).map(r=>`<div class="clean-reply-item"><div class="clean-comment-avatar">${esc(r.initials)}</div><div class="clean-reply-copy"><strong>${esc(r.name)}</strong>${esc(r.text)}</div></div>`).join('')}<div class="clean-reply-box"><textarea id="reply-${i}" rows="1" placeholder="Reply…"></textarea><button class="btn" onclick="postReply(${i})">Send</button></div></details></div>`).join('')}<div class="clean-comment-composer"><div class="clean-comment-composer-inner"><textarea id="newCommentText" rows="1" placeholder="Add a comment…"></textarea><button onclick="postNewComment()">➤</button></div>${selected?`<button class="btn primary clean-feedback-action" onclick="${generateAction}">Generate from ${selected} selected comment${selected===1?'':'s'}</button>`:''}</div>`;
  };

  renderRight = function(){
    const shell=document.getElementById('appShell');if(shell)shell.classList.toggle('right-open',!!(state.commentsOpen||state.rightMode==='versions'||state.panelOpen));
    if(state.commentsOpen){renderCommentsPanel();return;}if(state.rightMode==='versions'){renderVersionPanel();return;}
    const pct=Math.round(state.completed.size/stages.length*100),s=stages[state.stage],selectedSegments=state.segmentGenerated?state.segments.filter(x=>x.selected).map(x=>x.name).join(', ')||'None selected':'Not generated';
    document.getElementById('rightPanel').innerHTML=`<div class="context-panel-head"><h3>Campaign context</h3><button class="comments-close" onclick="closeContextPanel()">×</button></div><details class="clean-context-block" open><summary>Campaign</summary><div class="clean-context-body"><div class="clean-context-line"><span>Objective</span><span>£7.3m uplift · deepen UKC relationships</span></div><div class="clean-context-line"><span>Audience</span><span>${esc(selectedSegments)}</span></div><div class="clean-context-line"><span>Channels</span><span>${esc(state.channels.join(' · '))}</span></div><div class="clean-context-line"><span>Version</span><span>v${state.workflowVersion}.0</span></div></div></details><details class="clean-context-block"><summary>Evidence</summary><div class="clean-context-body">${state.files.map(f=>`<div class="source">${ICON.file}<div><strong>${esc(f)}</strong></div></div>`).join('')}</div></details><details class="clean-context-block"><summary>Workflow</summary><div class="clean-context-body"><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-label"><span>${state.completed.size} of ${stages.length}</span><span>${pct}%</span></div><div class="clean-context-line"><span>Current stage</span><span>${esc(s.name.replace(/^\d+\. /,''))}</span></div></div></details><details class="clean-context-block"><summary>Recent activity</summary><div class="clean-context-body">${state.activities.slice(0,4).map(a=>`<div class="activity"><span class="activity-dot"></span><div><strong>${esc(a)}</strong></div></div>`).join('')}</div></details>`;
  };

  /* Modal previews follow the same rule: only the asset's own visual, never a stand-in. */
  previewDamAsset = function(i){const a=state.assets[i];const visual=a.imageUrl?`<div class="clean-creative asset-crop-full" style="height:360px;background-image:url('${esc(a.imageUrl)}')"></div>`:missingCreativePreview(a);document.getElementById('modalRoot').innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal wide"><h2>${esc(a.name)}</h2><p>Adobe DAM · ${esc(a.id)}</p>${visual}<div class="modal-actions"><button class="btn primary" onclick="closeModal()">Close</button></div></div></div>`;};
  previewOutput = function(key){const o=state.outputs[key];document.getElementById('modalRoot').innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal wide"><h2>${esc(o.label)}</h2><p>Adobe GenStudio · v${o.version}.0</p>${renderOutputPreview(o)}<div class="modal-actions"><button class="btn primary" onclick="closeModal()">Close</button></div></div></div>`;};

  /* Update Campaign Studio handoff copy and specialist identity. */
  openCampaignStudioFromTeams = function(){
    if(!teamsState.summaryReady){toast('Wait for the Marketing Strategy & Campaign Brief Agent to finish preparing the brief');return;}
    document.getElementById('teamsExperience').style.display='none';const app=document.getElementById('appRoot');app.classList.remove('studio-hidden');app.classList.remove('not-started');
    state.started=true;state.initialPrompt='Create the iPortal campaign brief from the UKC Pod commercial discussion and connected Teams, Outlook and SharePoint sources.';state.sourceSearchComplete=true;state.completed.add(0);state.stage=1;state.focusStage=1;state.generatedAssets[1]=true;state.stagePrompts[1]=state.initialPrompt;state.activities.unshift('Campaign workspace created from the UKC Pod commercial discussion and connected sources');
    const name=document.querySelector('.agent-name');if(name)name.textContent='Marketing Strategy & Campaign Brief Agent';const sub=document.querySelector('.agent-sub');if(sub)sub.textContent='Marketing strategy, campaign brief and activation workflow';renderAll({scrollToStage:1});
  };

  /* Ensure replay starts from a clean, commercially led sequence. */
  replayTeamsDiscussion = function(){
    teamsState.runId+=1;Object.assign(teamsState,{paused:false,generating:false,summaryReady:false,authorised:false,replyOpen:null,thinkingStep:0,messages:[],typing:null,systemEventShown:false,agentIntroReady:false,acknowledgementReady:false,agentRecommendationReady:false,sequenceRunning:false,stableSequenceRunning:false,approvalInProgress:false,reactionPulse:null,peopleOpen:false,activeParticipant:null,activeParticipantStatus:'',creationAgentAdded:false,contextShared:false,coordinatorOpportunityReady:false,creationAgentIntroReady:false,provenanceReady:false,systemEvents:[],_lastRenderedMessageCount:0,_lastSummaryReady:false});renderTeams();setTimeout(runTeamsConversationSequence,350);
  };



  /* Final navigation cleanup */
  renderNav = function(){
    const first=document.querySelectorAll('.left .rail-title')[0],second=document.querySelectorAll('.left .rail-title')[1];
    if(first)first.textContent='Campaign planning';if(second)second.textContent='Production';
    const make=(indexes)=>indexes.map(i=>{const s=stages[i],display=i;return `<div class="stage ${i===state.focusStage?'active':''} ${state.completed.has(i)?'complete':''}" onclick="goStage(${i})"><div class="stage-dot">${state.completed.has(i)?'✓':display}</div><div class="stage-copy"><div class="stage-name">${esc(s.name.replace(/^\d+\. /,''))}</div></div></div>`;}).join('');
    document.getElementById('briefStages').innerHTML=make([1,2,3]);document.getElementById('productionStages').innerHTML=make([4,5,6,7]);
  };
  stageHeader = function(i,title,desc){const step=i===0?'Source grounding':`Stage ${i} of 7`;return `<div class="stage-banner"><div><div class="eyebrow">${step}</div><h2>${esc(title)}</h2>${desc?`<p>${esc(desc)}</p>`:''}</div><span class="status-chip ${state.completed.has(i)?'complete':''}">${state.completed.has(i)?'Completed':'In progress'}</span></div>`;};

  /* Prevent the older scheduled sequence from starting, then launch the stable queue. */
  teamsState.sequenceRunning=true;
  ensurePlaybackControls();
  renderTeams();
  setTimeout(function(){replayTeamsDiscussion();},650);
})();
