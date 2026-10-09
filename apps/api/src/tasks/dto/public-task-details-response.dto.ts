export type PublicTaskType = 'PHYSICAL' | 'VIRTUAL';
export type PublicTaskDuration = 'SHORT_TERM' | 'LONG_TERM';
export type PublicTaskStatus = 'PUBLISHED' | 'RECEIVING_APPLICATIONS';

export class PublicTaskDetailsResponseDto {
  id!: string;
  title!: string;
  description!: string;
  type!: PublicTaskType;
  duration!: PublicTaskDuration;
  status!: PublicTaskStatus;
  currency!: string;
  budgetMin!: string | null;
  budgetMax!: string | null;
  expectedCompletionAt!: string | null;
  requirements!: string | null;
  createdAt!: string;
  updatedAt!: string;
  location!: {
    country: { id: string; name: string; code: string };
    region: { id: string; name: string } | null;
    city: { id: string; name: string } | null;
    area: string | null;
  } | null;
  category!: {
    id: string;
    name: string;
  };
  requirementsList!: Array<{
    id: string;
    taskId: string;
    name: string;
    value: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  attachments!: Array<{
    id: string;
    taskId: string;
    fileName: string | null;
    fileType: string | null;
    fileSize: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
}
