-- AI interviewer follow-ups: each FOLLOW_UP question points at the original question it digs into.

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "parentQuestionId" UUID;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_parentQuestionId_fkey" FOREIGN KEY ("parentQuestionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
