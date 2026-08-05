export type ClientStatus =
  | "activo"
  | "prospecto"
  | "en_evaluacion"
  | "aprobado"
  | "restringido"
  | "inactivo";

export type IdentificationType = "Cédula" | "Pasaporte";

export interface Client {
  id: string;
  fullName: string;
  idType: IdentificationType;
  idNumber: string;
  phone: string;
  email: string;
  companyId: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  address: string;
  observations?: string;
  status: ClientStatus;
  registeredAt: string;
  assignedAdvisorId: string;
}
