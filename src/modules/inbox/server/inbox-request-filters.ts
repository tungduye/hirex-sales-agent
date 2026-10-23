import "server-only";

/** Suối Nguồn filters as they travel in the URL (?channel=&account=&owner=&tag=&tagMode=&firstFrom=&firstTo=&view=&q=&unread=1&cursor=). */
export function inboxFiltersFrom(query: URLSearchParams) {
  return {
    channelType: query.getAll("channel"),
    accountId: query.getAll("account"),
    ownerIds: query.getAll("owner"),
    page: query.get("page") ?? undefined,
    tagIds: query.getAll("tag"),
    tagMatchMode: query.get("tagMode") ?? undefined,
    firstMessageFrom: query.get("firstFrom") ?? undefined,
    firstMessageTo: query.get("firstTo") ?? undefined,
    view: query.get("view") ?? undefined,
    search: query.get("q") ?? undefined,
    unread: query.get("unread") === "1",
    cursor: query.get("cursor") ?? undefined,
  };
}
