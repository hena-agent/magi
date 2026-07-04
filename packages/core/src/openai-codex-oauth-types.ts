export type PkceCodes = {
  verifier: string;
  challenge: string;
};

export type OpenAICodexLoginResult = {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
};

export type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export type DeviceUserCodeResponse = {
  device_auth_id: string;
  user_code: string;
  interval: string;
};

export type DeviceTokenResponse = {
  authorization_code: string;
  code_verifier: string;
};

export type IdTokenClaims = {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};
