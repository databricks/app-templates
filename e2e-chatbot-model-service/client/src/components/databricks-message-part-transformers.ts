import type { ChatMessage } from '@chat-template/core';
import { createDatabricksMessageCitationMarkdown } from './databricks-message-citation';
import type { TextUIPart } from 'ai';

/**
 * Creates segments of parts that can be rendered as a single component.
 * Used to render citations as part of the associated text.
 */
export const createMessagePartSegments = (parts: ChatMessage['parts']) => {
  // An array of arrays of parts
  // Allows us to render multiple parts as a single component
  const out: ChatMessage['parts'][] = [];
  for (const part of parts) {
    const lastBlock = out[out.length - 1] || null;
    const previousPart = lastBlock?.[lastBlock.length - 1] || null;

    // If the previous part is a text part and the current part is a source part, add it to the current block
    if (previousPart?.type === 'text' && part.type === 'source-url') {
      lastBlock.push(part);
    }
    // If the previous part is a source-url part and the current part is a source part, add it to the current block
    else if (
      previousPart?.type === 'source-url' &&
      part.type === 'source-url'
    ) {
      lastBlock.push(part);
    } else if (
      lastBlock?.[0]?.type === 'text' &&
      part.type === 'text' &&
      !isNamePart(part) &&
      !isNamePart(lastBlock[0])
    ) {
      // If the text part, or the previous part contains a <name></name> tag, add it to a new block
      // Otherwise, append sequential text parts to the same block
      lastBlock.push(part);
      //   }
    }
    // Otherwise, add the current part to a new block
    else {
      out.push([part]);
    }
  }

  return out;
};

export const isNamePart = (
  part: ChatMessage['parts'][number],
): part is TextUIPart => {
  return (
    part.type === 'text' &&
    part.text?.startsWith('<name>') &&
    part.text?.endsWith('</name>')
  );
};
export const formatNamePart = (part: ChatMessage['parts'][number]) => {
  if (!isNamePart(part)) return null;
  return part.text?.replace('<name>', '').replace('</name>', '');
};

/**
 * Takes a segment of parts and joins them into a markdown-formatted string.
 * Used to render citations as part of the associated text.
 */
export const joinMessagePartSegments = (parts: ChatMessage['parts']) => {
  return parts.reduce((acc, part) => {
    switch (part.type) {
      case 'text':
        return acc + part.text;
      case 'source-url':
        console.log("acc.endsWith('|')", acc.endsWith('|'));
        // Special case for markdown tables
        if (acc.endsWith('|')) {
          // 1. Remove the last pipe
          // 2. Insert the citation markdown
          // 3. Add the pipe back
          return `${acc.slice(0, -1)} ${createDatabricksMessageCitationMarkdown(part)}|`;
        }
        return `${acc} ${createDatabricksMessageCitationMarkdown(part)}`;
      default:
        return acc;
    }
  }, '');
};
