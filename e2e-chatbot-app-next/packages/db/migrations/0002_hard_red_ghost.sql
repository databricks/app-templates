CREATE TABLE "ai_chatbot"."Feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messageId" uuid NOT NULL,
	"chatId" uuid NOT NULL,
	"userId" text NOT NULL,
	"feedbackType" varchar NOT NULL,
	"mlflowAssessmentId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_chatbot"."Message" ADD COLUMN "traceId" text;--> statement-breakpoint
ALTER TABLE "ai_chatbot"."Feedback" ADD CONSTRAINT "Feedback_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "ai_chatbot"."Message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chatbot"."Feedback" ADD CONSTRAINT "Feedback_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "ai_chatbot"."Chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chatbot"."Feedback" ADD CONSTRAINT "Feedback_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "ai_chatbot"."User"("id") ON DELETE no action ON UPDATE no action;