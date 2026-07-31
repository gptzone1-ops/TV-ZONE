export type AccountType = "private" | "shared";
export type ServiceType = "netflix" | "shahid";

export type NetflixAccount = {
  id: string;
  email: string;
  password: string;
  use_automated_code?: boolean | null;
  supplier_code_url?: string | null;
  verification_code?: string | null;
  verification_code_received_at?: string | null;
  service_type?: ServiceType | null;
  account_type: AccountType;
  expires_at: string;
  created_at: string;
};

export type CustomerLink = {
  id: string;
  account_id: string;
  email?: string | null;
  link_number?: number | null;
  code_request_limit?: number | null;
  code_requested_count?: number | null;
  code_used_at?: string | null;
  selected_device?: "mobile" | "screen" | null;
  tv_approval_url?: string | null;
  has_used_tv_link?: boolean | null;
  tv_link_used_at?: string | null;
  updated_at?: string | null;
  uuid: string;
  short_id?: string | null;
  profile_name: string;
  profile_label: string;
  profile_code: string;
  service_type?: ServiceType | null;
  created_at: string;
  accounts?: NetflixAccount;
};
