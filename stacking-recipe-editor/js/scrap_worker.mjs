import {suggestSheet} from './scrap_suggestions.mjs?v=4.56';

// Planning can be expensive on nearly empty sheets. Keep dragging, scrolling
// and cancellation responsive while this isolated worker finds a suggestion.
self.onmessage=({data})=>{
  try { self.postMessage(suggestSheet(data)); }
  catch(error) { self.postMessage({error:error.message}); }
};
