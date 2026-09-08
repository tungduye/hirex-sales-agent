export const DELIVERY_EVENT_TYPES = ["ACCEPTED", "DELIVERED", "READ", "CLICKED", "REPLIED", "FAILED", "UNKNOWN"] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];

export interface DeliveryEventSummaryInput {
  outboundActionId: string;
  eventType: DeliveryEventType;
}

export interface DeliveryReport {
  actions: number;
  accepted: number;
  delivered: number;
  read: number;
  clicked: number;
  replied: number;
  failed: number;
  unknown: number;
}

export function summarizeDeliveryEvents(events: readonly DeliveryEventSummaryInput[]): DeliveryReport {
  const byAction = new Map<string, Set<DeliveryEventType>>();
  for (const event of events) {
    const current = byAction.get(event.outboundActionId) ?? new Set<DeliveryEventType>();
    current.add(event.eventType);
    byAction.set(event.outboundActionId, current);
  }
  const report: DeliveryReport = { actions: byAction.size, accepted: 0, delivered: 0, read: 0, clicked: 0, replied: 0, failed: 0, unknown: 0 };
  for (const eventTypes of byAction.values()) {
    if (eventTypes.has("ACCEPTED")) report.accepted += 1;
    if (eventTypes.has("DELIVERED")) report.delivered += 1;
    if (eventTypes.has("READ")) report.read += 1;
    if (eventTypes.has("CLICKED")) report.clicked += 1;
    if (eventTypes.has("REPLIED")) report.replied += 1;
    if (eventTypes.has("FAILED")) report.failed += 1;
    if (eventTypes.has("UNKNOWN")) report.unknown += 1;
  }
  return report;
}
