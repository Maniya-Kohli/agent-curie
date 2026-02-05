"""
Agent Orchestrator - Main agent logic.
Handles conversation flow, tool execution, and response generation.
"""

import logging
from typing import Dict, List, Optional
from agent.llm_interface import LLMInterface
from agent.memory import memory
from tools import TOOL_FUNCTIONS, TOOL_DEFINITIONS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AgentOrchestrator:
    """Main agent orchestrator that manages conversation and tool use."""
    
    def __init__(self):
        """Initialize the orchestrator."""
        self.llm = LLMInterface()
        self.max_iterations = 10  # Prevent infinite loops
        
        # System prompt
        self.system_prompt = """You are a helpful AI assistant with access to various tools.

Your capabilities:
- Get weather information for any location
- Search the web for current information
- Perform mathematical calculations
- Read and write files (in a sandbox)
- Execute Python code (in a restricted environment)
- List files in the sandbox directory

When a user asks you to do something:
1. Think about which tool(s) you need to use
2. Use the tools to gather information or perform actions
3. Provide a clear, helpful response based on the results

Be conversational and friendly. If a tool fails, explain what went wrong and suggest alternatives.

Important: 
- Files are stored in a sandbox directory (isolated environment)
- Code execution is restricted for security
- Web search requires API key (may not be available)"""
    
    async def process_message(self, user_id: str, message: str) -> str:
        """
        Process a user message and return response.
        
        Args:
            user_id: Unique user identifier
            message: User's message
        
        Returns:
            Agent's response
        """
        try:
            logger.info(f"Processing message from user {user_id}: {message[:50]}...")
            
            # Add user message to memory
            memory.add_message(user_id, "user", message)
            
            # Get conversation history
            conversation = memory.get_messages_for_llm(user_id, last_n=20)
            
            # Agent loop
            for iteration in range(self.max_iterations):
                logger.info(f"Iteration {iteration + 1}/{self.max_iterations}")
                
                # Call LLM
                response = await self.llm.complete(
                    messages=conversation,
                    tools=TOOL_DEFINITIONS,
                    system=self.system_prompt,
                    max_tokens=4096
                )
                
                # Check stop reason
                if response.stop_reason == "end_turn":
                    # Agent is done, extract final response
                    final_text = self._extract_text_response(response)
                    
                    # Add assistant response to memory
                    memory.add_message(user_id, "assistant", final_text)
                    
                    logger.info(f"Agent response: {final_text[:100]}...")
                    return final_text
                
                elif response.stop_reason == "tool_use":
                    # Agent wants to use tools
                    logger.info("Agent requested tool use")
                    
                    # Add assistant message (with tool use) to conversation
                    conversation.append({
                        "role": "assistant",
                        "content": response.content
                    })
                    
                    # Execute tools and collect results
                    tool_results = await self._execute_tools(response)
                    
                    # Add tool results to conversation
                    conversation.append({
                        "role": "user",
                        "content": tool_results
                    })
                    
                    # Continue loop to get final response
                    continue
                
                elif response.stop_reason == "max_tokens":
                    error_msg = "Response was too long. Please ask a more specific question."
                    memory.add_message(user_id, "assistant", error_msg)
                    return error_msg
                
                else:
                    logger.warning(f"Unexpected stop reason: {response.stop_reason}")
                    error_msg = f"Unexpected response from AI. Please try again."
                    memory.add_message(user_id, "assistant", error_msg)
                    return error_msg
            
            # Max iterations exceeded
            error_msg = "I apologize, but I couldn't complete your request within the allowed steps. Please try a simpler request."
            memory.add_message(user_id, "assistant", error_msg)
            return error_msg
            
        except Exception as e:
            logger.error(f"Error processing message: {e}", exc_info=True)
            error_msg = f"I encountered an error: {str(e)}"
            memory.add_message(user_id, "assistant", error_msg)
            return error_msg
    
    def _extract_text_response(self, response) -> str:
        """Extract text content from Claude response."""
        for block in response.content:
            if hasattr(block, 'text'):
                return block.text
        return "I processed your request but have no response."
    
    async def _execute_tools(self, response) -> List[Dict]:
        """
        Execute all tool calls from the response.
        
        Args:
            response: Claude API response with tool_use blocks
        
        Returns:
            List of tool result dictionaries
        """
        tool_results = []
        
        for block in response.content:
            if block.type == "tool_use":
                tool_name = block.name
                tool_input = block.input
                tool_id = block.id
                
                logger.info(f"Executing tool: {tool_name} with input: {tool_input}")
                
                # Execute the tool
                if tool_name in TOOL_FUNCTIONS:
                    try:
                        result = TOOL_FUNCTIONS[tool_name](**tool_input)
                        logger.info(f"Tool result: {result[:100]}...")
                    except Exception as e:
                        result = f"Error executing {tool_name}: {str(e)}"
                        logger.error(f"Tool execution error: {e}")
                else:
                    result = f"Error: Unknown tool '{tool_name}'"
                    logger.error(f"Unknown tool requested: {tool_name}")
                
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result
                })
        
        return tool_results
    
    def get_stats(self) -> Dict:
        """Get agent statistics."""
        return {
            "model": self.llm.model,
            **memory.get_stats()
        }


# Global orchestrator instance
orchestrator = AgentOrchestrator()