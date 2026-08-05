export type UserRole =
  | "administrador"
  | "gerente"
  | "analista"
  | "asesor"
  | "consulta";

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  initials: string;
  active: boolean;
}
