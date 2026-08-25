import type { Activity, Contact } from "@/types/crm";

export const contacts: Contact[] = [
  { id: "con-1", fullName: "Olivia Martin", initials: "OM", company: "Acme Systems", jobTitle: "VP of Sales", email: "olivia@acmesystems.io", phone: "+1 415 555 0142", country: "United States", source: "Referral", leadStatus: "QUALIFIED", leadScore: 92, lastActivity: "12 min ago" },
  { id: "con-2", fullName: "Ethan Chen", initials: "EC", company: "Northstar Labs", jobTitle: "Founder & CEO", email: "ethan@northstarlabs.co", phone: "+65 6123 8091", country: "Singapore", source: "LinkedIn", leadStatus: "ENGAGED", leadScore: 84, lastActivity: "38 min ago" },
  { id: "con-3", fullName: "Sofia Müller", initials: "SM", company: "Meridian Works", jobTitle: "Head of Operations", email: "sofia@meridianworks.com", phone: "+49 30 9018 2041", country: "Germany", source: "Website", leadStatus: "CONTACTED", leadScore: 67, lastActivity: "2 hours ago" },
  { id: "con-4", fullName: "James Wilson", initials: "JW", company: "BrightPath Finance", jobTitle: "Revenue Director", email: "james@brightpath.finance", phone: "+44 20 7946 0825", country: "United Kingdom", source: "Event", leadStatus: "OPPORTUNITY", leadScore: 89, lastActivity: "Yesterday" },
  { id: "con-5", fullName: "Mia Thompson", initials: "MT", company: "Koru Commerce", jobTitle: "Marketing Manager", email: "mia@korucommerce.nz", phone: "+64 9 555 0182", country: "New Zealand", source: "Outbound", leadStatus: "NEW", leadScore: 51, lastActivity: "Yesterday" },
  { id: "con-6", fullName: "Ren Ito", initials: "RI", company: "Sora Mobility", jobTitle: "Partnerships Lead", email: "ren@soramobility.jp", phone: "+81 3 5550 2911", country: "Japan", source: "Partner", leadStatus: "WON", leadScore: 97, lastActivity: "Aug 22" },
  { id: "con-7", fullName: "Ava Rodriguez", initials: "AR", company: "Acme Systems", jobTitle: "Sales Operations", email: "ava@acmesystems.io", phone: "+1 646 555 0174", country: "United States", source: "Import", leadStatus: "LOST", leadScore: 34, lastActivity: "Aug 20" },
  { id: "con-8", fullName: "Noah Williams", initials: "NW", company: "Meridian Works", jobTitle: "Procurement Manager", email: "noah@meridianworks.com", phone: "+49 40 555 9021", country: "Germany", source: "Website", leadStatus: "DO_NOT_CONTACT", leadScore: 18, lastActivity: "Aug 18" },
];

export const recentActivities: Activity[] = [
  { id: "act-1", title: "Lead qualified", detail: "Olivia Martin moved to Qualified", timestamp: "12 min ago", type: "status" },
  { id: "act-2", title: "Contact added", detail: "Ethan Chen joined Northstar Labs", timestamp: "38 min ago", type: "contact" },
  { id: "act-3", title: "Company updated", detail: "Meridian Works profile was enriched", timestamp: "2 hours ago", type: "company" },
  { id: "act-4", title: "Follow-up due", detail: "Review BrightPath Finance opportunity", timestamp: "Today, 4:30 PM", type: "task" },
];

export const dashboardMetrics = [
  { label: "Total Contacts", value: "248", change: "+12.5%", direction: "up" as const },
  { label: "Companies", value: "64", change: "+4 this month", direction: "up" as const },
  { label: "New Leads", value: "38", change: "+8.2%", direction: "up" as const },
  { label: "Qualified Leads", value: "21", change: "55% conversion", direction: "neutral" as const },
];
