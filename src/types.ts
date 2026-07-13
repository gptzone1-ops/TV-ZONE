export type AccountType = "private" | "shared";
export type ServiceType = "netflix" | "shahid";

export type NetflixAccount = {
  id: string;
  email: string;
  password: string;
  supplier_code_url?: string | null;
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
  created_at: string;
  accounts?: NetflixAccount;
};
