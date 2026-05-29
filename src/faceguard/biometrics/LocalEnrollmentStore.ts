import * as SecureStore from 'expo-secure-store';
import { PhotoDescriptor } from './PhotoDescriptor';

const ENROLLMENT_KEY = 'faceguard-local-enrollment-v1';

export type LocalEnrollment = {
  userId: string;
  name: string;
  embedding?: number[];
  descriptor?: PhotoDescriptor;
  enrolledAt: string;
};

export async function getLocalEnrollment(): Promise<LocalEnrollment | undefined> {
  const value = await SecureStore.getItemAsync(ENROLLMENT_KEY);
  if (!value) {
    return undefined;
  }

  return JSON.parse(value) as LocalEnrollment;
}

export async function saveLocalEnrollment(enrollment: LocalEnrollment): Promise<void> {
  await SecureStore.setItemAsync(ENROLLMENT_KEY, JSON.stringify(enrollment), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

export async function clearLocalEnrollment(): Promise<void> {
  await SecureStore.deleteItemAsync(ENROLLMENT_KEY);
}
