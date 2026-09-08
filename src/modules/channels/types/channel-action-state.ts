export interface ChannelActionState {
  status: "idle" | "success" | "error";
  message: string | null;
}
