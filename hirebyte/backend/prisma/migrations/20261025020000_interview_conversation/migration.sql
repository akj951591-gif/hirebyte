-- The AI interviewer conversation: greetings, replies, the candidate's questions and the answers to them.

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('INTERVIEWER', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "ConversationTurnKind" AS ENUM ('GREETING', 'REPLY', 'CLARIFICATION_REQUEST', 'CLARIFICATION', 'CLOSING');

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "questionId" UUID,
    "role" "ConversationRole" NOT NULL,
    "kind" "ConversationTurnKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationTurn_interviewId_createdAt_idx" ON "ConversationTurn"("interviewId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
