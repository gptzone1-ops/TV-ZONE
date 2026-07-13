export type AccountType = "private" | "shared";
export type ServiceType = "netflix" | "shahid";
export type OtpStatus = "not_requested" | "pending" | "used";

export type NetflixAccount = {
  id: string;
  email: string;
  password: string;
  service_type?: ServiceType | null;
  account_type: AccountType;
  expires_at: string;
  created_at: string;
};

export type CustomerLink = {
  id: string;
  account_id: string;
  uuid: string;
  short_id?: string | null;
  profile_name: string;
  profile_label: string;
  profile_code: string;
  service_type?: ServiceType | null;
  otp_status?: OtpStatus | null;
  otp_requested_at?: string | null;
  otp_used_at?: string | null;
  created_at: string;
  accounts?: NetflixAccount;
};
