export interface LoginState {
  error: "INVALID_CREDENTIALS" | "EMAIL_NOT_CONFIRMED" | "UNAVAILABLE" | null;
}

export const initialLoginState: LoginState = { error: null };
