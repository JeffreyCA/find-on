import { Parser } from 'htmlparser2';

/** Reads only post IDs, without rendering HTML or loading any of its resources. */
export function parseSearchIds(html: string): string[] | null {
  const ids = new Set<string>();
  const stack: { listing: boolean; promoted: boolean }[] = [];
  let foundListing = false;
  const parser = new Parser({
    onopentag(_name, attributes) {
      const classes = new Set((attributes['class'] ?? '').split(/\s+/));
      const marker =
        classes.has('search-result-listing') ||
        attributes['id'] === 'siteTable' ||
        attributes['id'] === 'noresults';
      foundListing ||= marker;
      const parent = stack.at(-1);
      const listing = marker || parent?.listing === true;
      const promoted = parent?.promoted === true || attributes['data-promoted'] === 'true';
      stack.push({ listing, promoted });
      const fullname = attributes['data-fullname'];
      if (
        listing &&
        !promoted &&
        (classes.has('search-result') || classes.has('thing')) &&
        fullname !== undefined &&
        /^t3_[a-z0-9]+$/i.test(fullname)
      ) {
        ids.add(fullname.toLowerCase());
      }
    },
    onclosetag() {
      stack.pop();
    },
  });
  parser.end(html);
  return foundListing ? [...ids] : null;
}
