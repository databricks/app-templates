import { href, type Page, pageLinks } from "../app/router";
import { BrandMark, PRODUCT_NAME } from "../config/brand";
import type { Me } from "../lib/api-client";
import { CommandMenu } from "./command-menu";
import { Icon } from "./icons";
import { UserMenu } from "./user-menu";

type TopBarProps = { page: Page; me: Me | undefined; conversationId: string | null };

// Brand, nav (tab bar on mobile), command menu, user menu. Brand link reopens current conversation.
export function TopBar({ page, me, conversationId }: TopBarProps) {
  const assistant = href("assistant", conversationId ?? undefined);
  return (
    <header className="bg-background sticky top-0 z-20 flex h-(--topbar) items-center gap-10 border-b px-6 max-md:gap-3 max-md:pr-3 max-md:pl-4">
      <a className="text-foreground flex items-center gap-2.5 text-[17px] font-semibold tracking-tight max-md:text-base" href={assistant}>
        <BrandMark />
        <span>{PRODUCT_NAME}</span>
      </a>
      <nav
        className="flex gap-1 self-stretch tabbar:bg-background tabbar:fixed tabbar:inset-x-0 tabbar:bottom-0 tabbar:z-30 tabbar:h-[calc(var(--tabbar)+env(safe-area-inset-bottom))] tabbar:gap-0 tabbar:border-t tabbar:pb-[env(safe-area-inset-bottom)] composing:tabbar:hidden"
        aria-label="Main"
      >
        {pageLinks().map((item) => (
          <a
            key={item.id}
            className="text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:border-primary -mb-px flex items-center gap-2 border-b-2 border-transparent px-3.5 text-[15px] font-medium tabbar:m-0 tabbar:flex-1 tabbar:flex-col tabbar:justify-center tabbar:gap-0.5 tabbar:border-t-2 tabbar:border-b-0 tabbar:p-0 tabbar:text-xs"
            href={item.id === "assistant" ? assistant : href(item.id)}
            aria-current={item.id === page ? "page" : undefined}
          >
            <Icon name={item.icon} className="hidden tabbar:block tabbar:size-[22px]" />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <CommandMenu />
        {me ? <UserMenu me={me} /> : null}
      </div>
    </header>
  );
}
