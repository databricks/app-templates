import {
  type PendingAttachment,
  SimpleImageAttachmentAdapter,
  WebSpeechDictationAdapter,
  WebSpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { SOURCE_MARKER } from "./components/cited-text";

const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

// Limit to stay under backend's 2,000,000 character data URL cap
const MAX_IMAGE_BYTES = 1_400_000;

const TOO_LARGE = "Larger than 1.4 MB. Attach a smaller image.";

// Image attachments sent as data URLs; oversized files show an error
class ImageAttachments extends SimpleImageAttachmentAdapter {
  override accept = IMAGE_TYPES;

  override async add(state: { file: File }): Promise<PendingAttachment> {
    const attachment = await super.add(state);
    if (state.file.size <= MAX_IMAGE_BYTES) return attachment;
    return { ...attachment, status: { type: "incomplete", reason: "error", message: TOO_LARGE } };
  }
}

export const IMAGE_ATTACHMENTS = new ImageAttachments();

// Read-aloud without source markers to avoid reading citations
class AnswerSpeech extends WebSpeechSynthesisAdapter {
  override speak(text: string) {
    return super.speak(text.replace(SOURCE_MARKER, ""));
  }
}

// Web Speech API adapters: browser-dependent dictation and TTS
export const VOICE_ADAPTERS = {
  dictation: WebSpeechDictationAdapter.isSupported() ? new WebSpeechDictationAdapter() : undefined,
  speech: "speechSynthesis" in window ? new AnswerSpeech() : undefined,
};
