export type SearchParamValues = Record<string, string | string[] | undefined>;

/** What Next hands a page as `searchParams`. */
export type SearchParams = Promise<SearchParamValues>;
