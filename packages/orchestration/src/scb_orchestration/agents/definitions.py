"""Agent definitions for the orchestration system"""
from crewai import Agent
from langchain_openai import ChatOpenAI


def create_brainstormer_agent(llm: ChatOpenAI = None) -> Agent:
    """Create the Brainstormer agent - generates ideas and identifies risks"""
    return Agent(
        role="Brainstormer",
        goal="Generate innovative ideas and identify potential risks for the user's request",
        backstory="""You are an expert creative thinker who excels at generating
        innovative ideas and identifying potential pitfalls. You think broadly and
        consider multiple angles before recommending solutions.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_infra_architect_agent(llm: ChatOpenAI = None) -> Agent:
    """Create the Infrastructure Architect agent - designs system architecture"""
    return Agent(
        role="Infra-Architect",
        goal="Design scalable and secure infrastructure for the proposed solution",
        backstory="""You are an expert in system architecture with deep knowledge
        of modern cloud infrastructure, security best practices, and scalability patterns.
        You design systems that are robust, maintainable, and cost-effective.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_story_writer_agent(llm: ChatOpenAI = None) -> Agent:
    """Create the Story Writer agent - creates user stories and requirements"""
    return Agent(
        role="StoryWriter",
        goal="Transform ideas into clear, actionable user stories and requirements",
        backstory="""You are an expert at breaking down complex requirements into
        clear, testable user stories. You ensure all stakeholders understand what
        needs to be built and why.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_coder_agent(llm: ChatOpenAI = None) -> Agent:
    """Create the Coder agent - implements features and fixes bugs"""
    return Agent(
        role="Coder",
        goal="Implement high-quality code based on the provided specifications",
        backstory="""You are a skilled software engineer who writes clean, maintainable,
        and well-documented code. You follow best practices and ensure your code
        is testable and robust.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_tester_agent(llm: ChatOpenAI = None) -> Agent:
    """Create the Tester agent - writes tests and validates implementations"""
    return Agent(
        role="Tester",
        goal="Ensure quality through comprehensive testing and validation",
        backstory="""You are a quality assurance expert who writes thorough tests
        and validates implementations against requirements. You catch bugs before
        users do and ensure the system works as expected.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_orchestrator_agent(llm: ChatOpenAI = None) -> Agent:
    """Create the Orchestrator agent - coordinates other agents"""
    return Agent(
        role="Orchestrator",
        goal="Coordinate the efforts of other agents and ensure the project succeeds",
        backstory="""You are an expert project manager who coordinates the efforts
        of specialists to deliver value. You break down work, assign tasks, and
        ensure quality deliverables reach the user.""",
        verbose=True,
        allow_delegation=True,
        llm=llm,
    )


# Agent registry for easy lookup
AGENTS = {
    "brainstormer": create_brainstormer_agent,
    "infra_architect": create_infra_architect_agent,
    "story_writer": create_story_writer_agent,
    "coder": create_coder_agent,
    "tester": create_tester_agent,
    "orchestrator": create_orchestrator_agent,
}


def get_agent(agent_name: str, llm: ChatOpenAI = None) -> Agent:
    """Get an agent by name"""
    factory = AGENTS.get(agent_name.lower())
    if not factory:
        raise ValueError(f"Unknown agent: {agent_name}")
    return factory(llm)
