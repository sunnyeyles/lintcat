/** Items per page on every paginated GitHub call, REST and GraphQL alike. */
export const PAGE_SIZE = 100;

/** Walks numbered pages until a short one; GitHub sends no other end marker. */
export async function paginate<T>(
  fetchPage: (page: number) => Promise<{ data: unknown }>,
  parsePage: (data: unknown) => T[],
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const pageItems = parsePage((await fetchPage(page)).data);
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE) {
      return items;
    }
  }
}
