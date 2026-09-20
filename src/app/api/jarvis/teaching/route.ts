import { requireJarvisOwner } from "../broker.ts";
import { teachingStore } from "../../../../jarvis/teaching-store.ts";
import { teachingLibraryResponse } from "../../../../jarvis/teaching-learning.ts";
import { lessonCommand, lessonLibrary, teachingLessons } from "../../../../jarvis/teaching-lessons.ts";
export const dynamic="force-dynamic";
export async function GET(){return teachingLibraryResponse(requireJarvisOwner,teachingStore,store=>lessonLibrary(store,teachingLessons()));}
export async function POST(request:Request){return lessonCommand(request,{authorize:requireJarvisOwner,store:teachingStore,lessons:teachingLessons});}
