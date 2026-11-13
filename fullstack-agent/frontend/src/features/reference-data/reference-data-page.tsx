import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { href } from "../../app/router";
import { Icon } from "../../components/icons";
import { Loading } from "../../components/loading";
import { EmptyPanel, PageSection, SEGMENTED } from "../../components/page";
import { ServiceProblem } from "../../components/service-problem";
import type { PageProps } from "../../config/pages";
import { formatMoney } from "../../lib/format";
import type { Product } from "./api";

type Group = { slug: string; type: string | null; label: string };

const GROUPS: Group[] = [
  { slug: "savings", type: "SAVINGS", label: "Savings" },
  { slug: "current", type: "CURRENT", label: "Current accounts" },
  { slug: "borrowing", type: "CREDIT_CARD", label: "Borrowing" },
];
const OTHER: Group = { slug: "other", type: null, label: "Other" };

// Bank products priced in EUR
const PRODUCT_CURRENCY = "EUR";
const SAVINGS_QUESTION = "Can I earn more on my savings?";

function groupOf(product: Product): Group {
  return GROUPS.find((group) => group.type === product.type) ?? OTHER;
}

function Rate({ product }: { product: Product }) {
  const rate = Number(product.rate_pct);
  if (rate <= 0) return <span className="text-xl font-semibold">None</span>;
  return (
    <span className="text-xl font-semibold whitespace-nowrap tabular-nums">
      {rate.toFixed(2)}%
      {product.type === "CREDIT_CARD" ? <small className="text-muted-foreground ml-1 text-[13px] font-medium">APR</small> : null}
    </span>
  );
}

function RatesTable({ group, products }: { group: Group; products: Product[] }) {
  return (
    <Card className="gap-0 py-0">
      <table className="w-full text-left text-[15px] max-md:block">
        <caption className="sr-only">{group.label} rates</caption>
        <thead className="max-md:hidden">
          <tr className="text-muted-foreground border-b text-[13px] [&>th]:px-5 [&>th]:py-3.5 [&>th]:font-medium">
            <th scope="col">Product</th>
            <th scope="col">Rate</th>
            <th scope="col">Monthly fee</th>
            <th scope="col">Terms</th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {products.map((product) => (
            <tr
              key={product.product_id}
              className="border-t first:border-t-0 max-md:block max-md:px-4 max-md:py-3.5 [&>*]:px-5 [&>*]:py-3.5 [&>*]:align-top [&>*]:wrap-anywhere max-md:[&>*]:p-0 max-md:[&>td]:mt-1.5 max-md:[&>td]:flex max-md:[&>td]:justify-between max-md:[&>td]:gap-4 max-md:[&>td]:text-right max-md:[&>td]:text-sm max-md:[&>td]:before:text-muted-foreground max-md:[&>td]:before:flex-none max-md:[&>td]:before:text-left max-md:[&>td]:before:content-[attr(data-label)]"
            >
              <th scope="row" className="font-semibold max-md:block">
                {product.name}
              </th>
              <td data-label="Rate" className="max-md:items-center">
                <Rate product={product} />
              </td>
              <td data-label="Monthly fee">
                {Number(product.monthly_fee) > 0 ? formatMoney(PRODUCT_CURRENCY, product.monthly_fee) : "None"}
              </td>
              <td data-label="Terms">{product.terms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RateTabs({ products, slug }: { products: Product[]; slug: string | null }) {
  const groups = [...GROUPS, OTHER].filter((group) => products.some((product) => groupOf(product) === group));
  const current = groups.find((group) => group.slug === slug) ?? groups[0];
  return (
    <>
      <nav className={SEGMENTED} aria-label="Product type">
        {groups.map((group) => (
          <a key={group.slug} href={href("rates", group.slug)} aria-current={group === current ? "page" : undefined}>
            {group.label}
          </a>
        ))}
      </nav>
      <RatesTable group={current} products={products.filter((product) => groupOf(product) === current)} />
    </>
  );
}

export function ReferenceDataPage({ data, detail: slug, onAsk }: PageProps) {
  const products = data.products;
  const list = products.value;
  return (
    <PageSection
      titleId="rates-title"
      title="Rates"
      description="These rates apply to all customers."
      action={
        <Button asChild variant="outline" size="lg">
          <a href={href("assistant")} onClick={() => onAsk(SAVINGS_QUESTION)}>
            <Icon name="chat" className="size-4.5" />
            Compare with my savings
          </a>
        </Button>
      }
    >
      {products.failed ? (
        <ServiceProblem title="We can't show our rates right now" onRetry={products.retry} />
      ) : !list ? (
        <Loading text="Loading our rates" />
      ) : list.length === 0 ? (
        <EmptyPanel>No products are available at the moment.</EmptyPanel>
      ) : (
        <RateTabs products={list} slug={slug} />
      )}
    </PageSection>
  );
}
