-- Migration: Add traceId column to Message for MLflow trace linkage
ALTER TABLE "ai_chatbot"."Message" ADD COLUMN "traceId" text;
