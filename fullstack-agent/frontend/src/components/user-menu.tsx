import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Me } from "../lib/api-client";
import { Icon } from "./icons";

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserMenu({ me }: { me: Me }) {
  const name = me.display_name ?? me.user_name;
  return (
    <Popover>
      <PopoverTrigger className="hover:bg-accent ml-auto flex items-center gap-2.5 rounded-full py-1 pr-2 pl-1 text-[15px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:p-1 max-md:min-h-11 max-md:min-w-11 max-md:justify-center">
        <Avatar className="size-8">
          <AvatarFallback className="text-foreground text-[13px] font-bold">{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="max-w-60 truncate max-lg:hidden">{name}</span>
        <Icon name="chevron" className="text-muted-foreground size-4 max-lg:hidden" />
        <span className="sr-only">Account menu</span>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Account" className="grid w-66 p-4 text-sm wrap-anywhere">
        <strong className="font-semibold">{name}</strong>
        <span className="text-muted-foreground">{me.email}</span>
      </PopoverContent>
    </Popover>
  );
}
