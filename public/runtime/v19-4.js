
(function(){
  'use strict';

  /* Teams already contains a generated brief. Open that artifact directly instead of replaying Source Grounding. */
  window.openCampaignStudioFromTeams=function(){
    if(!teamsState.summaryReady){toast('Wait for the Marketing Strategy & Campaign Brief Agent to finish preparing the brief');return;}
    const teams=document.getElementById('teamsExperience'),app=document.getElementById('appRoot');
    if(teams)teams.style.display='none';
    if(app){app.classList.remove('studio-hidden');app.classList.remove('not-started');}
    state.started=true;
    state.sourceSearchComplete=true;
    state.initialPrompt='Create the iPortal Digital Engagement Campaign brief from the UKC Pod discussion and connected Teams, Outlook and SharePoint evidence.';
    state.completed.add(0);
    state.stage=Math.max(state.stage,1);
    state.focusStage=1;
    state.generatedAssets[1]=true;
    state.stagePrompts[1]=stages[1].prompt;
    state.activities.unshift('Opened the campaign brief created from the UKC Pod discussion and connected sources');
    renderAll({scrollToStage:1});
    requestAnimationFrame(function(){
      const a=stageAgent(1),name=document.querySelector('.agent-name'),sub=document.querySelector('.agent-sub');
      if(name)name.textContent=a.name;if(sub)sub.textContent=a.sub;
    });
  };

  function agencyAssetForCurrentThread(){
    if(!state.commentsOpen||state.commentAsset?.type!=='subasset')return null;
    const key=state.commentAsset.key;
    return state.assets.find(function(a){return a.commentsKey===key;})||null;
  }

  /* Extend the restored rich threaded panel with the external reviewer live state. */
  const richCommentsPanel=renderCommentsPanel;
  renderCommentsPanel=function(){
    richCommentsPanel();
    const item=agencyAssetForCurrentThread();
    if(!item)return;
    const status=item.externalApprovalStatus||'Not requested';
    const active=!!item.agencyTyping || /Preparing|Awaiting|Reviewing/.test(status);
    if(!active)return;
    const panel=document.getElementById('rightPanel');
    if(!panel)return;
    const header=panel.querySelector('.context');
    const live=document.createElement('div');
    live.className='agency-thread-live';
    live.innerHTML='<div class="agency-thread-live-top"><div class="agency-thread-live-avatar">EL</div><div class="agency-thread-live-copy"><strong>Emma Lewis · External Agency</strong><span>Reviewing the current creative and adding comments to this thread.</span></div></div><div class="agency-thread-live-status">Updating review comments <span class="thinking-dots"><span></span><span></span><span></span></span></div>';
    if(header&&header.parentNode)header.parentNode.insertBefore(live,header.nextSibling);else panel.prepend(live);
  };

  /* External agency review now opens and updates the exact asset thread in real time. */
  window.sendForExternalApproval=function(kind,key){
    const item=externalItem(kind,key);if(!item)return;
    closeModal();
    item.externalApprovalStatus='Preparing review';
    item.externalReviewerId='emma-lewis';
    item.externalApprovalRequestedAt='Just now';
    item.externalApprovalCompletedAt=null;
    item.externalApprovedVersion=null;
    item.agencyTyping=true;

    const ckey=externalCommentsKey(kind,key);
    if(kind==='asset'&&ckey){
      if(!state.subAssetComments[ckey])state.subAssetComments[ckey]=[];
      openSubAssetComments(5,ckey,item.requirement||item.name||'Asset review',['External agency approval','Creative hierarchy','Channel suitability','CTA and product interface','Final export quality']);
    }else{
      renderAll();
    }
    addActivity((item.name||item.label||item.requirement)+' sent to Emma Lewis for external agency review');

    setTimeout(function(){
      item.externalApprovalStatus='Awaiting agency comments';
      item.agencyTyping=true;
      renderAll();
      if(state.commentsOpen)renderRight();
    },900);

    setTimeout(function(){
      if(ckey){
        if(!state.subAssetComments[ckey])state.subAssetComments[ckey]=[];
        const existing=state.subAssetComments[ckey].find(function(c){return c.initials==='EL'&&c.location==='External agency approval'&&c.time==='Just now';});
        if(!existing){
          state.subAssetComments[ckey].push({
            initials:'EL',name:'Emma Lewis',role:'Creative Director · External Agency',time:'Just now',location:'External agency approval',
            text:'I reviewed the current version. The visual hierarchy and channel format work well. Please retain the approved CTA and ensure the iPortal interface remains legible at the final export size.',
            selected:false,incorporated:false,replies:[]
          });
        }
      }
      item.agencyTyping=false;
      item.externalApprovalStatus='Approved with comments';
      item.externalApprovalCompletedAt='Just now';
      item.externalApprovedVersion=item.version||1;
      addActivity((item.name||item.label||item.requirement)+' approved with comments by Emma Lewis · External Agency');
      renderAll();
      if(state.commentsOpen)renderRight();
      toast('Emma Lewis added review comments to the asset thread');
    },3000);
  };

  /* Re-render whichever surface is currently visible after installing the overrides. */
  if(document.getElementById('appRoot')&&!document.getElementById('appRoot').classList.contains('studio-hidden'))renderAll();else renderTeams();
})();
