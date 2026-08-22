package example;
public class OpportunityService {
  private final OpportunityRepository opportunityRepository;
  public Opportunity create(OpportunityRequest request) {
    if (request == null) throw new IllegalArgumentException("request is required");
    Opportunity opportunity = new Opportunity();
    opportunity.setStatus("PENDING");
    return opportunityRepository.save(opportunity);
  }
}
