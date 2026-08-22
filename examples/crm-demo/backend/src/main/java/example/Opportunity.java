package example;
import jakarta.persistence.Entity;
@Entity
public class Opportunity {
  private Long id;
  private String status;
  public void setStatus(String status) { this.status = status; }
}
