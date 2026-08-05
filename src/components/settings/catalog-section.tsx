import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";

interface CatalogItem {
  label: string;
  badgeClass?: string;
  description?: string;
}

interface CatalogSectionProps {
  title: string;
  description: string;
  items: CatalogItem[];
}

export function CatalogSection({ title, description, items }: CatalogSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                )}
              </div>
              {item.badgeClass && <StatusBadge label={item.label} className={item.badgeClass} />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
