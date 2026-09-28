import {exportCutPlans} from './scrap_editor.mjs?v=4.44';

// An editable Mozaik source job can be downloaded for review even when its
// scrap plan cannot be released. Never serialize failed cuts as machine plans.
export function prepareScrapExport(nest, {allowReviewOnly=false}={}) {
  try { return {manualSheets:exportCutPlans(nest),review:null,draft:null}; }
  catch (cause) {
    if (!allowReviewOnly) {
      const error=new Error(cause.message,{cause});
      error.code='SCRAP_PLAN_REVIEW_REQUIRED';
      throw error;
    }
    return {
      manualSheets:[],
      review:'MOZAIK SOURCE FOR REVIEW ONLY — NOT PRODUCTION READY.\n\n'
        +cause.message+'\n\n'
        +'Your part positions and drawn scrap cuts are preserved. No executable scrap plans are included.\n'
        +'Correct the flagged scrap plan in the nest editor, recheck every sheet, then export again.\n'
        +'The automatic production ZIP remains blocked until all sheets pass.\n',
      draft:{schemaVersion:1,purpose:'editor-review-only',nest:structuredClone(nest)}
    };
  }
}
