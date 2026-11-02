export function Loading({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground" role="status">
      {text}
    </p>
  );
}
