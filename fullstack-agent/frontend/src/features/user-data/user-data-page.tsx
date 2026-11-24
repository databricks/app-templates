import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { href } from "../../app/router";
import { Icon } from "../../components/icons";
import { Loading } from "../../components/loading";
import { EmptyPanel, PageSection } from "../../components/page";
import { ServiceProblem } from "../../components/service-problem";
import { ending } from "../../config/actions";
import type { PageProps } from "../../config/pages";
import { capitalised, formatMoney } from "../../lib/format";
import type { Account } from "./api";

const ACCOUNT_KINDS: Record<string, string> = {
  CURRENT: "Current account",
  SAVINGS: "Savings account",
  CREDIT_CARD: "Credit card",
};

const OPEN = "OPEN";

function groupedIban(iban: string): string {
  return iban.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
}

// Show amount owed for credit cards (negative balance), unavailable for NULL
function headline(account: Account): { label: string; amount: string } {
  if (account.balance === null) {
    return { label: "Balance", amount: "Unavailable" };
  }
  const balance = Number(account.balance);
  if (account.account_type === "CREDIT_CARD" && balance < 0) {
    return { label: "Amount owed", amount: formatMoney(account.currency, -balance) };
  }
  return { label: "Balance", amount: formatMoney(account.currency, balance) };
}

type Ask = (question: string) => void;

function Figure({ label, value, isMain = false }: { label: string; value: string; isMain?: boolean }) {
  return (
    <div data-slot="figure">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", isMain ? "text-[28px] leading-tight tracking-tight" : "text-[17px]")}>
        {value}
      </dd>
    </div>
  );
}

function AccountDetail({ account, onAsk }: { account: Account; onAsk: Ask }) {
  const main = headline(account);
  const limit = account.credit_limit === null ? null : Number(account.credit_limit);
  const available =
    account.balance === null || limit === null
      ? null
      : limit + Number(account.balance);
  return (
    <Card className="gap-0 p-0">
      <section className="p-6 max-md:px-4 max-md:py-4.5" aria-labelledby="account-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="account-title" className="text-xl font-semibold wrap-anywhere">
              {account.nickname}
            </h2>
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-[15px]">
              {ACCOUNT_KINDS[account.account_type] ?? capitalised(account.account_type)}, ending {ending(account.iban)}
              {account.status !== OPEN ? <Badge variant="secondary">{capitalised(account.status)}</Badge> : null}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="max-md:min-h-11">
            <a href={href("assistant")} onClick={() => onAsk(`Tell me about my ${account.nickname}`)}>
              <Icon name="chat" className="size-4" />
              Ask about this account
            </a>
          </Button>
        </div>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 max-md:gap-x-7">
          <Figure label={main.label} value={main.amount} isMain />
          {limit === null ? null : (
            <>
              <Figure label="Credit limit" value={formatMoney(account.currency, limit)} />
              <Figure
                label="Available credit"
                value={available === null ? "Unavailable" : formatMoney(account.currency, available)}
              />
            </>
          )}
          <Figure label="IBAN" value={groupedIban(account.iban)} />
        </dl>
      </section>
    </Card>
  );
}

function AccountList({ accounts, selected, onAsk }: { accounts: Account[]; selected: Account; onAsk: Ask }) {
  return (
    <div className="grid items-start gap-6 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] max-md:gap-4">
      <nav aria-label="Your accounts">
        <ul className="grid gap-2">
          {accounts.map((account) => {
            const main = headline(account);
            return (
              <li key={account.account_id}>
                <a
                  className="bg-card text-foreground hover:border-ring aria-[current=page]:border-primary grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-xl border p-4"
                  href={href("accounts", account.account_id)}
                  aria-current={account === selected ? "page" : undefined}
                >
                  <span className="font-semibold wrap-anywhere">{account.nickname}</span>
                  <span className="text-right font-semibold tabular-nums">{main.amount}</span>
                  <span className="text-muted-foreground text-sm">Ending {ending(account.iban)}</span>
                  <span className="text-muted-foreground text-right text-sm">{main.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <AccountDetail account={selected} onAsk={onAsk} />
    </div>
  );
}

export function UserDataPage({ data, detail: selectedId, onAsk }: PageProps) {
  const accounts = data.accounts;
  const list = accounts.value;
  return (
    <PageSection titleId="accounts-title" title="Accounts">
      {accounts.failed ? (
        <ServiceProblem title="We can't show your accounts right now" onRetry={accounts.retry} />
      ) : !list ? (
        <Loading text="Loading your accounts" />
      ) : list.length === 0 ? (
        <EmptyPanel>You don't have any accounts with us yet.</EmptyPanel>
      ) : (
        <AccountList
          accounts={list}
          selected={list.find((account) => account.account_id === selectedId) ?? list[0]}
          onAsk={onAsk}
        />
      )}
    </PageSection>
  );
}
