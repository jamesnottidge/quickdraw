'use client';

import { use } from 'react';
import { Conversation } from '@/components/conversation';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Conversation key={id} id={id} />;
}
