import { generateText } from 'ai';
import { myProvider } from '@/lib/ai/providers';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('Direct test endpoint received:', JSON.stringify(body, null, 2));

    // Accept both standard AI SDK format and responses API format
    const messages = body.messages || body.input || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Simple text generation without database saves
    const model = await myProvider.languageModel('chat-model');
    const result = await generateText({
      model,
      messages: messages,
    });

    return Response.json({
      success: true,
      text: result.text,
      usage: result.usage,
      finishReason: result.finishReason,
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return Response.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}