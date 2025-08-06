from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import boto3
import json
import os

app = FastAPI()
bedrock = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 1000

@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest):
    try:
        # Convert OpenAI format to Bedrock format
        prompt = "\n".join([f"{msg.role}: {msg.content}" for msg in request.messages])
        
        response = bedrock.invoke_model(
            modelId=request.model,
            body=json.dumps({
                "prompt": prompt,
                "max_tokens_to_sample": request.max_tokens,
                "temperature": request.temperature,
            })
        )
        
        result = json.loads(response['body'].read())
        
        # Convert back to OpenAI format
        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": result.get("completion", "")
                },
                "finish_reason": "stop"
            }],
            "model": request.model
        }
    except Exception