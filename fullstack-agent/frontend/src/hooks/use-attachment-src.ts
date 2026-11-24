import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";

// Create and revoke object URL for file lifetime, return URL if file unchanged
const useFileSrc = (file: File | undefined) => {
  const [entry, setEntry] = useState<{ file: File; url: string } | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setEntry(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setEntry({ file, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return entry !== undefined && entry.file === file ? entry.url : undefined;
};

// Image source: object URL while composing, data URL when sent
export const useAttachmentSrc = () => {
  const file = useAuiState((s) => (s.attachment.type === "image" ? s.attachment.file : undefined));
  const src = useAuiState((s) =>
    s.attachment.type === "image" ? s.attachment.content?.filter((c) => c.type === "image")[0]?.image : undefined,
  );
  return useFileSrc(file) ?? src;
};
