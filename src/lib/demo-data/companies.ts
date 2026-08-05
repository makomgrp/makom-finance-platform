import type { Company } from "@/types";

export const COMPANIES: Company[] = [
  {
    id: "c-001",
    name: "Grupo Kativo",
    sector: "Manufactura",
    directDiscount: true,
    contactName: "Departamento de Nómina",
    contactPhone: "+507 279-1000",
  },
  {
    id: "c-002",
    name: "Cable & Wireless Panamá",
    sector: "Telecomunicaciones",
    directDiscount: true,
    contactName: "Recursos Humanos",
    contactPhone: "+507 208-6200",
  },
  {
    id: "c-003",
    name: "Super99",
    sector: "Comercio y retail",
    directDiscount: true,
    contactName: "Nómina Corporativa",
    contactPhone: "+507 300-9900",
  },
  {
    id: "c-004",
    name: "Copa Airlines",
    sector: "Aviación",
    directDiscount: true,
    contactName: "Compensación y Beneficios",
    contactPhone: "+507 304-2672",
  },
  {
    id: "c-005",
    name: "Banco General",
    sector: "Banca",
    directDiscount: true,
    contactName: "Recursos Humanos",
    contactPhone: "+507 303-5001",
  },
  {
    id: "c-006",
    name: "Ministerio de Educación (MEDUCA)",
    sector: "Sector público",
    directDiscount: true,
    contactName: "Oficina de Planillas",
    contactPhone: "+507 512-6000",
  },
  {
    id: "c-007",
    name: "Café Durán",
    sector: "Agroindustria",
    directDiscount: false,
    contactName: "Administración",
    contactPhone: "+507 236-2100",
  },
  {
    id: "c-008",
    name: "Aeropuerto Internacional de Tocumen",
    sector: "Sector público",
    directDiscount: true,
    contactName: "Recursos Humanos",
    contactPhone: "+507 238-2700",
  },
  {
    id: "c-009",
    name: "Hospital Nacional",
    sector: "Salud",
    directDiscount: false,
    contactName: "Nómina",
    contactPhone: "+507 207-8100",
  },
  {
    id: "c-010",
    name: "Distribuidora Panamá S.A.",
    sector: "Logística y distribución",
    directDiscount: false,
    contactName: "Administración",
    contactPhone: "+507 260-4455",
  },
];

export function getCompanyById(id: string): Company | undefined {
  return COMPANIES.find((company) => company.id === id);
}
