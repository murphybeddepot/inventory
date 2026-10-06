import {exportCutPlans,reviewScrapSheet} from './scrap_editor.mjs?v=4.56';

export function prepareScrapExport(nest,{allowReviewOnly=false,overrideWarnings=false}={}) {
  const issues=nest.sheets.flatMap((sheet,i)=>reviewScrapSheet(sheet,nest,i).issues);
  const warnings=issues.filter(x=>x.severity==='warning'),errors=issues.filter(x=>x.severity==='error');
  const describe=items=>items.map(x=>`Sheet ${x.sheet}: ${x.message}`).join('\n');
  try {
    const manualSheets=exportCutPlans(nest,{overrideWarnings});
    return {manualSheets,review:overrideWarnings&&warnings.length?'EXPORTED WITH OPERATOR-ACCEPTED WARNINGS\n\n'+describe(warnings)
      +'\n\nYour scrap cuts are included. Accepted warnings travel with each plan and are recorded in the final machining report.\n':null,draft:null};
  } catch(cause) {
    if(!allowReviewOnly){
      const error=new Error(describe(issues)||cause.message,{cause});
      error.code=errors.length?'SCRAP_PLAN_REVIEW_REQUIRED':'SCRAP_WARNINGS_OVERRIDE';
      throw error;
    }
    return {manualSheets:[],review:'MOZAIK SOURCE FOR REVIEW ONLY — NOT PRODUCTION READY.\n\n'+describe(issues)
      +'\n\nCorrect the listed machining errors in the editor. Draft cuts are preserved separately; no executable scrap plan is included.\n',
      draft:{schemaVersion:1,purpose:'editor-review-only',nest:structuredClone(nest)}};
  }
}
