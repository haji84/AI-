export type RevocationEvent={subjectType:"agent"|"worker"|"device"|"session"|"grant";subjectId:string;at:number;reason:string;generation:number};
export class RevocationRegistry{
  private generation=0;private events:RevocationEvent[]=[];
  revoke(subjectType:RevocationEvent["subjectType"],subjectId:string,reason:string,at=Date.now()){const event={subjectType,subjectId,reason,at,generation:++this.generation};this.events.push(event);return event;}
  isRevoked(subjectType:RevocationEvent["subjectType"],subjectId:string){return this.events.some(e=>e.subjectType===subjectType&&e.subjectId===subjectId);}
  since(generation:number){return this.events.filter(e=>e.generation>generation);}
  currentGeneration(){return this.generation;}
}
