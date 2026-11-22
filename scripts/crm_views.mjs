// CRM's declared canvas views (app-kit 0.8.0, screen-route-params.v1): one source for the
// build (screens.json `views`) and the verifier. Each param is a filter the screen already
// applies on open (src/domain/routeParams.ts); nothing here is a new filter.
export const views = [
  { id: 'customers', label: { en: 'Customers', 'zh-TW': '客戶' }, section: 'customers',
    params: { q: { type: 'string' }, consent: { type: 'enum', values: ['granted', 'unknown', 'denied'] }, source: { type: 'string' }, tag: { type: 'string' } } },
  { id: 'segments', label: { en: 'Segments', 'zh-TW': '客群' }, section: 'segments', params: { q: { type: 'string' } } },
  { id: 'campaigns', label: { en: 'Campaigns', 'zh-TW': '行銷活動' }, section: 'campaigns', params: { q: { type: 'string' } } },
  { id: 'segment', label: { en: 'Segment by id', 'zh-TW': '指定客群' }, section: 'segments', params: { id: { type: 'string' } } },
  { id: 'campaign', label: { en: 'Campaign by id', 'zh-TW': '指定行銷活動' }, section: 'campaigns', params: { id: { type: 'string' } } },
];
