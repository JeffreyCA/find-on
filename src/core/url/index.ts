// Public entry point of the URL normalization and matching module. Pure TS, no browser APIs.
//
// Pages and submitted URLs are compared through three keys (see keys.ts):
//   SAME    equal site identity (YouTube video, arXiv paper, tweet, GitHub repo, Reddit or HN post)
//   EXACT   equal after safe normalization (scheme, www, tracking parameters, encoding, wrappers)
//   SIMILAR equal after aggressive normalization (m./amp. hosts, AMP paths, most parameters)
// Use checkEligibility() first: only its sanitized URL may be sent to other services.

/** Bump whenever normalization output changes, so cached results keyed on old rules are ignored. */
export const RULES_VERSION: number = 2;

export { checkEligibility, type Eligibility } from './eligibility';
export {
  classify,
  classifyHits,
  computeKeys,
  displayUrl,
  splitIdentity,
  type UrlKeys,
} from './keys';
export { redditVariants } from './variants';
