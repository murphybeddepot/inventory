import {suggestCuts} from './scrap_editor.mjs?v=4.39';

// Planning can be expensive on nearly empty sheets. Keep dragging, scrolling
// and cancellation responsive while this isolated worker finds a suggestion.
self.onmessage=({data})=>{
  try { self.postMessage({plan:suggestCuts(data.sheet,data.nest,data.settings)}); }
  catch(error) { self.postMessage({error:error.message}); }
};
