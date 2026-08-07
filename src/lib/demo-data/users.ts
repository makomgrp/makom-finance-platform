import type { User } from "@/types";

export const USERS: User[] = [
  {
    id: "u-001",
    fullName: "Gabriel Herrera",
    email: "gabriel.herrera@odlfinancial.com",
    role: "administrador",
    initials: "GH",
    active: true,
    preferredLanguage: "en",
  },
  {
    id: "u-002",
    fullName: "Marisol Duarte",
    email: "marisol.duarte@odlfinancial.com",
    role: "gerente",
    initials: "MD",
    active: true,
    preferredLanguage: "es",
  },
  {
    id: "u-003",
    fullName: "Ricardo Sanjur",
    email: "ricardo.sanjur@odlfinancial.com",
    role: "analista",
    initials: "RS",
    active: true,
    preferredLanguage: "es",
  },
  {
    id: "u-004",
    fullName: "Fernando Quintero",
    email: "fernando.quintero@odlfinancial.com",
    role: "asesor",
    initials: "FQ",
    active: true,
    preferredLanguage: "es",
  },
  {
    id: "u-005",
    fullName: "Lucía Batista",
    email: "lucia.batista@odlfinancial.com",
    role: "asesor",
    initials: "LB",
    active: true,
    preferredLanguage: "fr",
  },
  {
    id: "u-006",
    fullName: "Diego Espino",
    email: "diego.espino@odlfinancial.com",
    role: "asesor",
    initials: "DE",
    active: true,
    preferredLanguage: "en",
  },
  {
    id: "u-007",
    fullName: "Paola Rivas",
    email: "paola.rivas@odlfinancial.com",
    role: "consulta",
    initials: "PR",
    active: true,
    preferredLanguage: "fr",
  },
];

export const ADVISORS = USERS.filter((user) => user.role === "asesor");

export const CURRENT_USER: User = USERS[0];

export function getUserById(id: string): User | undefined {
  return USERS.find((user) => user.id === id);
}
